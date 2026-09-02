import type { TechniqueTier, NotationMode } from './cube';

export interface AlgorithmEntry {
  name: string;
  subset?: string;
  algorithm: string;
  algorithmSimplified?: string;
  twoLookRole?: 'corners-only' | 'edges-only' | null;
  notes?: string;
}

export interface AlgorithmDataset {
  _source?: string;
  _notes?: string;
  OLL: AlgorithmEntry[];
  PLL: AlgorithmEntry[];
  F2L: AlgorithmEntry[];
  OLL_2LOOK_EDGE_ORIENTATION?: AlgorithmEntry[];
}

export type SolverWorkerRequest =
  | { type: 'INIT_DATABASE'; payload: AlgorithmDataset }
  | { type: 'GENERATE_SCRAMBLE' }
  | { type: 'SOLVE_CROSS'; patternData: any }
  | {
      type: 'FIND_HINT';
      phase: string;
      patternData: any;
      activeSlot?: string;
      techniqueTier?: TechniqueTier;
      notationMode?: NotationMode;
      tier?: any;
      method?: any;
    }
  | { type: 'RECONSTRUCT_ALG'; patternData: any }
  | {
      type: 'GENERATE_TRAINING_SCRAMBLE';
      caseSource: 'OLL' | 'PLL' | 'F2L' | 'OLL_2LOOK_EDGE';
      /** Non-empty allowlist of dataset case names to pick a random target from. */
      caseNames: string[];
    };




export type SolverWorkerResponse =
  | { type: 'DATABASE_INITIALIZED' }
  | { type: 'SCRAMBLE_GENERATED'; scramble: string; moves: string[] }
  | { type: 'CROSS_SOLVED'; moves: string[]; description?: string }
  | {
      type: 'HINT_FOUND';
      phase: string;
      moves: string[];
      caseName: string;
      subset?: string;
      targetSlot?: string;
    }
  | { type: 'ALG_RECONSTRUCTED'; alg: string }
  | {
      type: 'TRAINING_SCRAMBLE_GENERATED';
      moves: string[];
      caseName: string;
      subset: string;
      algorithm: string;
      algorithmSimplified: string;
      targetSlot?: string;
    }
  | { type: 'ERROR'; message: string };
