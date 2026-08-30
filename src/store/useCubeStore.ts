import { create } from 'zustand';
import type { KPattern } from 'cubing/kpuzzle';
import { Alg } from 'cubing/alg';
import type { CFOPPhase, F2LSlotId, PhaseStatus, SmartCubeState, TimestampedMove } from '../types/cube';
import { getKPuzzle, getPostZ2Pattern, relabelMoveZ2 } from '../utils/kpuzzleHelper';
import { evaluateCFOPFromPattern, resolveMonotonicCFOPPhase } from '../utils/phaseDetector';

/**
 * Dedicated CFOP phase tracker for a connected Timed Solve.
 *
 * The main `pattern` is kept in the raw physical move frame (so guided scramble and the 3D
 * visualizer stay consistent — see CLAUDE.md), and during a connected solve it accumulates
 * the physical scramble turns on top of the z2 scramble target, so it is *not* a clean
 * representation of the cube for CFOP detection. This tracker instead seeds from the clean
 * `default · scramble · z2` state and advances by the z2-relabel of each physical move —
 * the one frame in which `evaluateCFOPFromPattern` reports cross / F2L / OLL / PLL / solved
 * on time (verified in `src/tests/solvePhaseTracker.test.ts`).
 */
export interface SolveTrackerState {
  active: boolean;
  pattern: KPattern | null;
  moveHistory: TimestampedMove[];
  status: PhaseStatus;
  monotonicPhase: CFOPPhase;
  solvedSlots: F2LSlotId[];
}

interface CubeStoreState {
  isInitialized: boolean;
  pattern: KPattern | null;
  scramblePattern: KPattern | null;
  lastMove: string | null;
  lastMoveTimestamp: number;

  moveHistory: TimestampedMove[];
  phaseStatus: PhaseStatus;
  monotonicPhase: CFOPPhase;
  solvedSlots: F2LSlotId[];
  smartCube: SmartCubeState;

  /** Connected Timed Solve CFOP tracker — see SolveTrackerState above. */
  solveTracker: SolveTrackerState;

  /**
   * An alg that reconstructs the live `pattern` from a solved cube, in `pattern`'s own
   * move-letter frame. Unlike `moveHistory` (which resets at the start of each solve for
   * per-solve telemetry), this keeps growing for as long as a smart cube stays connected,
   * so it always mirrors the cube's true physical state for 3D visualization — including
   * right after connecting to a cube that's already mid-solve, when there's no separately
   * known "scramble string" to fall back on. Empty means "no live physical reconstruction
   * available" (no cube connected, or its protocol can't report state).
   */
  visualAlg: string;

  // Actions
  init: () => Promise<void>;
  applyMove: (move: string, timestamp?: number) => void;
  undoLastMove: () => void;
  undoMoves: (count: number) => void;
  syncPhysicalPattern: (pattern: KPattern) => void;
  resetToSolved: () => void;
  setScramble: (scrambleStr: string) => Promise<void>;
  setSmartCubeState: (state: Partial<SmartCubeState>) => void;
  resetSolveTracking: () => void;
  setVisualAlg: (alg: string) => void;
  beginSolveTracking: (seed: KPattern) => void;
  endSolveTracking: () => void;
}

const INACTIVE_SOLVE_TRACKER: SolveTrackerState = {
  active: false,
  pattern: null,
  moveHistory: [],
  status: {
    isCrossSolved: false,
    solvedSlots: [],
    isF2LSolved: false,
    isOLLSolved: false,
    isPLLSolved: false,
    isFullySolved: false,
    currentPhase: 'cross',
  },
  monotonicPhase: 'cross',
  solvedSlots: [],
};



const DEFAULT_PHASE_STATUS: PhaseStatus = {
  isCrossSolved: false,
  solvedSlots: [],
  isF2LSolved: false,
  isOLLSolved: false,
  isPLLSolved: false,
  isFullySolved: false,
  currentPhase: 'cross',
};

export const useCubeStore = create<CubeStoreState>((set, get) => ({
  isInitialized: false,
  pattern: null,
  scramblePattern: null,
  lastMove: null,
  lastMoveTimestamp: 0,
  moveHistory: [],
  phaseStatus: DEFAULT_PHASE_STATUS,
  monotonicPhase: 'cross',
  solvedSlots: [],
  visualAlg: '',
  solveTracker: INACTIVE_SOLVE_TRACKER,
  smartCube: {
    isConnected: false,
    isConnecting: false,
    deviceName: null,
    batteryLevel: null,
    error: null,
    stateReadSupported: true,
  },

  init: async () => {
    if (get().isInitialized) return;
    await getKPuzzle();
    const pattern = getPostZ2Pattern();
    const status = evaluateCFOPFromPattern(pattern);
    set({
      isInitialized: true,
      pattern,
      phaseStatus: status,
      monotonicPhase: status.currentPhase,
      solvedSlots: status.solvedSlots,
    });
  },

  syncPhysicalPattern: (pattern: KPattern) => {
    try {
      const status = evaluateCFOPFromPattern(pattern);
      set({
        pattern,
        scramblePattern: pattern,
        phaseStatus: status,
        monotonicPhase: status.currentPhase,
        solvedSlots: status.solvedSlots,
        lastMove: null,
        lastMoveTimestamp: 0,
        moveHistory: [],
        solveTracker: INACTIVE_SOLVE_TRACKER,
        // Cleared here (before the async reconstruction lands) so the visualizer never
        // shows a stale alg left over from a previous connection.
        visualAlg: '',
      });
    } catch (err) {
      console.warn('Failed to sync physical pattern:', err);
    }
  },

  applyMove: (move: string, timestamp: number = Date.now()) => {
    const { pattern, monotonicPhase, solvedSlots, moveHistory, visualAlg, solveTracker } = get();
    if (!pattern) return;

    try {
      const nextPattern = pattern.applyAlg(new Alg(move));
      const nextStatus = evaluateCFOPFromPattern(nextPattern);

      const lastTimestamp = moveHistory.length > 0 ? moveHistory[moveHistory.length - 1].timestamp : timestamp;
      const deltaMs = Math.max(0, timestamp - lastTimestamp);

      const resolved = resolveMonotonicCFOPPhase(monotonicPhase, solvedSlots, nextStatus);

      const newMoveItem: TimestampedMove = {
        move,
        timestamp,
        deltaMs,
        phase: resolved.phase,
      };

      // Advance the connected-solve CFOP tracker in its own (z2-relabelled) frame — kept
      // entirely separate from `pattern` / `visualAlg`, which stay in the raw frame.
      let nextSolveTracker = solveTracker;
      if (solveTracker.active && solveTracker.pattern) {
        try {
          const tPattern = solveTracker.pattern.applyAlg(new Alg(relabelMoveZ2(move)));
          const tStatus = evaluateCFOPFromPattern(tPattern);
          const tResolved = resolveMonotonicCFOPPhase(
            solveTracker.monotonicPhase,
            solveTracker.solvedSlots,
            tStatus
          );
          const tLastTs =
            solveTracker.moveHistory.length > 0
              ? solveTracker.moveHistory[solveTracker.moveHistory.length - 1].timestamp
              : timestamp;
          nextSolveTracker = {
            active: true,
            pattern: tPattern,
            moveHistory: [
              ...solveTracker.moveHistory,
              { move, timestamp, deltaMs: Math.max(0, timestamp - tLastTs), phase: tResolved.phase },
            ],
            status: tStatus,
            monotonicPhase: tResolved.phase,
            solvedSlots: tResolved.solvedSlots,
          };
        } catch (trackErr) {
          console.warn(`Solve tracker failed to apply move '${move}':`, trackErr);
        }
      }

      set({
        pattern: nextPattern,
        lastMove: move,
        lastMoveTimestamp: timestamp,
        moveHistory: [...moveHistory, newMoveItem],
        phaseStatus: nextStatus,
        monotonicPhase: resolved.phase,
        solvedSlots: resolved.solvedSlots,
        visualAlg: visualAlg ? `${visualAlg} ${move}` : move,
        solveTracker: nextSolveTracker,
      });
    } catch (err) {
      console.warn(`Failed to apply move '${move}' to store pattern:`, err);
    }
  },

  undoLastMove: () => {
    const { moveHistory, scramblePattern, pattern } = get();
    if (moveHistory.length === 0 || !pattern) return;

    const newHistory = moveHistory.slice(0, -1);
    const lastMoveItem = moveHistory[moveHistory.length - 1];

    try {
      const invertedAlg = new Alg(lastMoveItem.move).invert();
      const prevPattern = pattern.applyAlg(invertedAlg);
      const nextStatus = evaluateCFOPFromPattern(prevPattern);

      let monotonicPhase: CFOPPhase = 'cross';
      let solvedSlots: F2LSlotId[] = [];

      if (scramblePattern) {
        let pat = scramblePattern;
        let phase: CFOPPhase = 'cross';
        let slots: F2LSlotId[] = [];
        for (const item of newHistory) {
          pat = pat.applyAlg(new Alg(item.move));
          const s = evaluateCFOPFromPattern(pat);
          const r = resolveMonotonicCFOPPhase(phase, slots, s);
          phase = r.phase;
          slots = r.solvedSlots;
        }
        monotonicPhase = phase;
        solvedSlots = slots;
      } else {
        monotonicPhase = nextStatus.currentPhase;
        solvedSlots = nextStatus.solvedSlots;
      }

      const visualAlgTokens = get().visualAlg.split(/\s+/).filter(Boolean);
      visualAlgTokens.pop();

      set({
        pattern: prevPattern,
        lastMove: newHistory.length > 0 ? newHistory[newHistory.length - 1].move : null,
        lastMoveTimestamp: newHistory.length > 0 ? newHistory[newHistory.length - 1].timestamp : 0,
        moveHistory: newHistory,
        phaseStatus: nextStatus,
        monotonicPhase,
        solvedSlots,
        visualAlg: visualAlgTokens.join(' '),
      });
    } catch (err) {
      console.warn('Failed to undo last move in store:', err);
    }
  },

  undoMoves: (count: number) => {
    for (let i = 0; i < count; i++) {
      get().undoLastMove();
    }
  },



  resetToSolved: () => {
    try {
      const pattern = getPostZ2Pattern();
      const status = evaluateCFOPFromPattern(pattern);
      set({
        pattern,
        lastMove: null,
        moveHistory: [],
        phaseStatus: status,
        monotonicPhase: 'solved',
        solvedSlots: ['FR', 'FL', 'BR', 'BL'],
        visualAlg: '',
        solveTracker: INACTIVE_SOLVE_TRACKER,
      });
    } catch (err) {
      console.warn('Failed to reset store to solved state:', err);
    }
  },

  setScramble: async (scrambleStr: string) => {
    const kp = await getKPuzzle();
    const base = kp.defaultPattern();
    const fullScrambleAlg = `${scrambleStr} z2`.trim();
    const pattern = base.applyAlg(new Alg(fullScrambleAlg));
    const status = evaluateCFOPFromPattern(pattern);

    set({
      pattern,
      scramblePattern: pattern,
      lastMove: null,
      moveHistory: [],
      phaseStatus: status,
      monotonicPhase: 'cross',
      solvedSlots: [],
      // This is a known, app-generated scramble string (used directly as the
      // visualizer's setup elsewhere) — not a live physical reconstruction.
      visualAlg: '',
      solveTracker: INACTIVE_SOLVE_TRACKER,
    });
  },

  setSmartCubeState: (newState) => {
    set((state) => ({
      smartCube: {
        ...state.smartCube,
        ...newState,
      },
    }));
  },

  setVisualAlg: (alg: string) => set({ visualAlg: alg }),

  resetSolveTracking: () => {
    const { pattern } = get();
    if (!pattern) return;
    const status = evaluateCFOPFromPattern(pattern);
    set({
      moveHistory: [],
      lastMove: null,
      phaseStatus: status,
      monotonicPhase: status.currentPhase,
      solvedSlots: status.solvedSlots,
    });
  },

  beginSolveTracking: (seed: KPattern) => {
    try {
      const status = evaluateCFOPFromPattern(seed);
      set({
        solveTracker: {
          active: true,
          pattern: seed,
          moveHistory: [],
          status,
          monotonicPhase: status.currentPhase,
          solvedSlots: status.solvedSlots,
        },
      });
    } catch (err) {
      console.warn('Failed to begin solve tracking:', err);
      set({ solveTracker: INACTIVE_SOLVE_TRACKER });
    }
  },

  endSolveTracking: () => set({ solveTracker: INACTIVE_SOLVE_TRACKER }),
}));
