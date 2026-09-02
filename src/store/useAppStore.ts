import { create } from 'zustand';
import type { AppMode, TechniqueTier, NotationMode, ScrambleFeedback } from '../types/cube';
import type { TrainingPhase } from '../types/db';
import { classifyScrambleMove } from '../utils/scrambleTracker';

/** Session-scoped Training tally (not persisted — only completed reps go to Dexie). */
export interface TrainingStats {
  attempts: number;
  solved: number;
  streak: number;
}

interface AppStoreState {
  activeMode: AppMode;
  currentProfileId: string;
  currentScramble: string;
  scrambleMoves: string[];
  scrambleProgressIndex: number;
  /**
   * Live physical move-sequence tracking (smart cube connected) — independent of the
   * manual `scrambleProgressIndex` path. Mode-neutral: Scramble mode feeds it the WCA
   * scramble, Training mode feeds it a case-targeted scramble. See utils/scrambleTracker.ts.
   */
  trackTargetMoves: string[];
  trackRemainingMoves: string[];
  trackDoneMoves: string[];
  trackFeedback: ScrambleFeedback | null;
  trackCorrectionActive: boolean;
  isProfileModalOpen: boolean;
  techniqueTier: TechniqueTier;
  notationMode: NotationMode;

  /** Training mode: which CFOP phase is being drilled. */
  trainingSubMode: TrainingPhase;
  /** Training mode: `'full'` (whole case set) or a 2-Look drill id (`'oll-corners'` …). */
  trainingMethod: string;
  /** Full OLL/PLL: restrict to one case `subset`, or `null` for the whole set. */
  trainingCaseFilter: string | null;
  /** 2-Look drill: allowlist of case names to drill, or `null` for all the drill's cases. */
  trainingCaseAllow: string[] | null;
  /** F2L drill: which slot to drill, or `'random'` for a random slot each rep. */
  trainingF2lSlot: 'FR' | 'FL' | 'BR' | 'BL' | 'random';
  trainingStats: TrainingStats;

  setMode: (mode: AppMode) => void;
  setProfileId: (id: string) => void;
  setScramble: (scramble: string, moves: string[]) => void;
  setScrambleProgressIndex: (index: number) => void;
  advanceScrambleProgress: () => void;
  stepBackScrambleProgress: () => void;
  resetScrambleProgress: () => void;
  completeScrambleProgress: () => void;
  /** Point the physical tracker at a move sequence (without touching the Scramble-tab scramble). */
  setTrackTarget: (moves: string[]) => void;
  applyPhysicalTrackMove: (move: string) => void;
  clearTrackFeedback: () => void;
  resetPhysicalTrack: () => void;
  setTrainingSubMode: (phase: TrainingPhase) => void;
  setTrainingMethod: (method: string) => void;
  setTrainingCaseFilter: (subset: string | null) => void;
  setTrainingCaseAllow: (names: string[] | null) => void;
  setTrainingF2lSlot: (slot: 'FR' | 'FL' | 'BR' | 'BL' | 'random') => void;
  recordTrainingAttempt: (solved: boolean) => void;
  resetTrainingStats: () => void;
  setIsProfileModalOpen: (open: boolean) => void;
  setTechniqueTier: (tier: TechniqueTier) => void;
  setNotationMode: (mode: NotationMode) => void;
}

export const useAppStore = create<AppStoreState>((set) => ({
  activeMode: 'scramble',
  currentProfileId: 'default-profile',
  currentScramble: '',
  scrambleMoves: [],
  scrambleProgressIndex: 0,
  trackTargetMoves: [],
  trackRemainingMoves: [],
  trackDoneMoves: [],
  trackFeedback: null,
  trackCorrectionActive: false,
  isProfileModalOpen: false,
  techniqueTier: '2look',
  notationMode: 'simplified',
  trainingSubMode: 'OLL',
  trainingMethod: 'full',
  trainingCaseFilter: null,
  trainingCaseAllow: null,
  trainingF2lSlot: 'random',
  trainingStats: { attempts: 0, solved: 0, streak: 0 },

  setMode: (activeMode) => set({ activeMode }),
  setProfileId: (currentProfileId) => set({ currentProfileId }),
  setScramble: (currentScramble, scrambleMoves) =>
    set({
      currentScramble,
      scrambleMoves,
      scrambleProgressIndex: 0,
      trackTargetMoves: scrambleMoves,
      trackRemainingMoves: scrambleMoves,
      trackDoneMoves: [],
      trackFeedback: null,
      trackCorrectionActive: false,
    }),
  setScrambleProgressIndex: (scrambleProgressIndex) => set({ scrambleProgressIndex }),
  advanceScrambleProgress: () =>
    set((state) => ({
      scrambleProgressIndex: Math.min(state.scrambleProgressIndex + 1, state.scrambleMoves.length),
    })),
  stepBackScrambleProgress: () =>
    set((state) => ({
      scrambleProgressIndex: Math.max(0, state.scrambleProgressIndex - 1),
    })),
  resetScrambleProgress: () =>
    set((state) => ({
      scrambleProgressIndex: 0,
      trackRemainingMoves: state.trackTargetMoves,
      trackDoneMoves: [],
      trackFeedback: null,
      trackCorrectionActive: false,
    })),
  completeScrambleProgress: () =>
    set((state) => ({
      scrambleProgressIndex: state.scrambleMoves.length,
    })),
  setTrackTarget: (moves) =>
    set({
      trackTargetMoves: moves,
      trackRemainingMoves: moves,
      trackDoneMoves: [],
      trackFeedback: null,
      trackCorrectionActive: false,
    }),
  applyPhysicalTrackMove: (move) =>
    set((state) => {
      const res = classifyScrambleMove(
        state.trackTargetMoves,
        state.trackDoneMoves,
        move,
        state.trackCorrectionActive,
      );
      if (res.kind === 'ignored') return {};

      const feedback: ScrambleFeedback | null =
        res.kind === 'error'
          ? { kind: 'error', corrections: res.corrections, at: Date.now() }
          : res.kind === 'partial'
          ? { kind: 'partial', corrections: res.corrections, at: Date.now() }
          : null;

      return {
        trackDoneMoves: res.nextDone,
        trackRemainingMoves: res.nextRemaining,
        trackCorrectionActive: res.correctionActive,
        trackFeedback: feedback,
      };
    }),
  clearTrackFeedback: () => set({ trackFeedback: null }),
  resetPhysicalTrack: () =>
    set((state) => ({
      trackRemainingMoves: state.trackTargetMoves,
      trackDoneMoves: [],
      trackFeedback: null,
      trackCorrectionActive: false,
    })),
  setTrainingSubMode: (trainingSubMode) =>
    set({ trainingSubMode, trainingMethod: 'full', trainingCaseFilter: null, trainingCaseAllow: null }),
  setTrainingMethod: (trainingMethod) => set({ trainingMethod, trainingCaseFilter: null, trainingCaseAllow: null }),
  setTrainingCaseFilter: (trainingCaseFilter) => set({ trainingCaseFilter }),
  setTrainingCaseAllow: (trainingCaseAllow) => set({ trainingCaseAllow }),
  setTrainingF2lSlot: (trainingF2lSlot) => set({ trainingF2lSlot }),
  recordTrainingAttempt: (solved) =>
    set((state) => ({
      trainingStats: {
        attempts: state.trainingStats.attempts + 1,
        solved: state.trainingStats.solved + (solved ? 1 : 0),
        streak: solved ? state.trainingStats.streak + 1 : 0,
      },
    })),
  resetTrainingStats: () => set({ trainingStats: { attempts: 0, solved: 0, streak: 0 } }),
  setIsProfileModalOpen: (isProfileModalOpen) => set({ isProfileModalOpen }),
  setTechniqueTier: (techniqueTier) => set({ techniqueTier }),
  setNotationMode: (notationMode) => set({ notationMode }),
}));
