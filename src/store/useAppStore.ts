import { create } from 'zustand';
import type { AppMode, TechniqueTier, NotationMode, ScrambleFeedback } from '../types/cube';
import { classifyScrambleMove } from '../utils/scrambleTracker';

interface AppStoreState {
  activeMode: AppMode;
  currentProfileId: string;
  currentScramble: string;
  scrambleMoves: string[];
  scrambleProgressIndex: number;
  /** Live guided-scramble tracking (smart cube connected) — independent of the index path. */
  scrambleRemainingMoves: string[];
  scrambleDoneMoves: string[];
  scrambleFeedback: ScrambleFeedback | null;
  scrambleCorrectionActive: boolean;
  isProfileModalOpen: boolean;
  techniqueTier: TechniqueTier;
  notationMode: NotationMode;
  guidanceTier: TechniqueTier;
  guidanceMethod: TechniqueTier;

  setMode: (mode: AppMode) => void;
  setProfileId: (id: string) => void;
  setScramble: (scramble: string, moves: string[]) => void;
  setScrambleProgressIndex: (index: number) => void;
  advanceScrambleProgress: () => void;
  stepBackScrambleProgress: () => void;
  resetScrambleProgress: () => void;
  completeScrambleProgress: () => void;
  applyPhysicalScrambleMove: (move: string) => void;
  clearScrambleFeedback: () => void;
  resetPhysicalScramble: () => void;
  setIsProfileModalOpen: (open: boolean) => void;
  setTechniqueTier: (tier: TechniqueTier) => void;
  setNotationMode: (mode: NotationMode) => void;
  setGuidanceTier: (tier: TechniqueTier) => void;
  setGuidanceMethod: (method: TechniqueTier) => void;
}

export const useAppStore = create<AppStoreState>((set) => ({
  activeMode: 'scramble',
  currentProfileId: 'default-profile',
  currentScramble: '',
  scrambleMoves: [],
  scrambleProgressIndex: 0,
  scrambleRemainingMoves: [],
  scrambleDoneMoves: [],
  scrambleFeedback: null,
  scrambleCorrectionActive: false,
  isProfileModalOpen: false,
  techniqueTier: '2look',
  notationMode: 'simplified',
  guidanceTier: '2look',
  guidanceMethod: '2look',

  setMode: (activeMode) => set({ activeMode }),
  setProfileId: (currentProfileId) => set({ currentProfileId }),
  setScramble: (currentScramble, scrambleMoves) =>
    set({
      currentScramble,
      scrambleMoves,
      scrambleProgressIndex: 0,
      scrambleRemainingMoves: scrambleMoves,
      scrambleDoneMoves: [],
      scrambleFeedback: null,
      scrambleCorrectionActive: false,
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
      scrambleRemainingMoves: state.scrambleMoves,
      scrambleDoneMoves: [],
      scrambleFeedback: null,
      scrambleCorrectionActive: false,
    })),
  completeScrambleProgress: () =>
    set((state) => ({
      scrambleProgressIndex: state.scrambleMoves.length,
    })),
  applyPhysicalScrambleMove: (move) =>
    set((state) => {
      const res = classifyScrambleMove(
        state.scrambleMoves,
        state.scrambleDoneMoves,
        move,
        state.scrambleCorrectionActive,
      );
      if (res.kind === 'ignored') return {};

      const feedback: ScrambleFeedback | null =
        res.kind === 'error'
          ? { kind: 'error', corrections: res.corrections, at: Date.now() }
          : res.kind === 'partial'
          ? { kind: 'partial', corrections: res.corrections, at: Date.now() }
          : null;

      return {
        scrambleDoneMoves: res.nextDone,
        scrambleRemainingMoves: res.nextRemaining,
        scrambleCorrectionActive: res.correctionActive,
        scrambleFeedback: feedback,
      };
    }),
  clearScrambleFeedback: () => set({ scrambleFeedback: null }),
  resetPhysicalScramble: () =>
    set((state) => ({
      scrambleRemainingMoves: state.scrambleMoves,
      scrambleDoneMoves: [],
      scrambleFeedback: null,
      scrambleCorrectionActive: false,
    })),
  setIsProfileModalOpen: (isProfileModalOpen) => set({ isProfileModalOpen }),
  setTechniqueTier: (techniqueTier) => set({ techniqueTier, guidanceTier: techniqueTier, guidanceMethod: techniqueTier }),
  setNotationMode: (notationMode) => set({ notationMode }),
  setGuidanceTier: (guidanceTier) => set({ techniqueTier: guidanceTier, guidanceTier, guidanceMethod: guidanceTier }),
  setGuidanceMethod: (guidanceMethod) => set({ techniqueTier: guidanceMethod, guidanceTier: guidanceMethod, guidanceMethod }),
}));




