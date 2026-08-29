import { create } from 'zustand';
import type { AppMode, TechniqueTier, NotationMode } from '../types/cube';

interface AppStoreState {
  activeMode: AppMode;
  currentProfileId: string;
  currentScramble: string;
  scrambleMoves: string[];
  scrambleProgressIndex: number;
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
    set({
      scrambleProgressIndex: 0,
    }),
  completeScrambleProgress: () =>
    set((state) => ({
      scrambleProgressIndex: state.scrambleMoves.length,
    })),
  setIsProfileModalOpen: (isProfileModalOpen) => set({ isProfileModalOpen }),
  setTechniqueTier: (techniqueTier) => set({ techniqueTier, guidanceTier: techniqueTier, guidanceMethod: techniqueTier }),
  setNotationMode: (notationMode) => set({ notationMode }),
  setGuidanceTier: (guidanceTier) => set({ techniqueTier: guidanceTier, guidanceTier, guidanceMethod: guidanceTier }),
  setGuidanceMethod: (guidanceMethod) => set({ techniqueTier: guidanceMethod, guidanceTier: guidanceMethod, guidanceMethod }),
}));




