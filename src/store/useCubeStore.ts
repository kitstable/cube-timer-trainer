import { create } from 'zustand';
import type { KPattern } from 'cubing/kpuzzle';
import { Alg } from 'cubing/alg';
import type { CFOPPhase, F2LSlotId, PhaseStatus, SmartCubeState, TimestampedMove } from '../types/cube';
import { getKPuzzle, getPostZ2Pattern } from '../utils/kpuzzleHelper';
import { evaluateCFOPFromPattern, resolveMonotonicCFOPPhase } from '../utils/phaseDetector';

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
}



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
      });
    } catch (err) {
      console.warn('Failed to sync physical pattern:', err);
    }
  },

  applyMove: (move: string, timestamp: number = Date.now()) => {
    const { pattern, monotonicPhase, solvedSlots, moveHistory } = get();
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

      set({
        pattern: nextPattern,
        lastMove: move,
        lastMoveTimestamp: timestamp,
        moveHistory: [...moveHistory, newMoveItem],
        phaseStatus: nextStatus,
        monotonicPhase: resolved.phase,
        solvedSlots: resolved.solvedSlots,
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

      set({
        pattern: prevPattern,
        lastMove: newHistory.length > 0 ? newHistory[newHistory.length - 1].move : null,
        lastMoveTimestamp: newHistory.length > 0 ? newHistory[newHistory.length - 1].timestamp : 0,
        moveHistory: newHistory,
        phaseStatus: nextStatus,
        monotonicPhase,
        solvedSlots,
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
}));
