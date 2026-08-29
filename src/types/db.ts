export interface Profile {
  id: string;
  name: string;
  createdAt: number;
}

export type PhaseName =
  | 'inspection'
  | 'solve'
  | 'cross'
  | 'f2l-1'
  | 'f2l-2'
  | 'f2l-3'
  | 'f2l-4'
  | 'oll'
  | 'pll';

export interface PhaseSplit {
  name: PhaseName;
  startTs: number;
  endTs: number;
  moveCount: number;
  tps?: number;
  pauseRatio?: number;
}

export interface Solve {
  id: string;
  profileId: string;
  scrambleMoves: string[];
  mode: 'timed' | 'guided';
  cubeConnected: boolean;
  phases: PhaseSplit[];
  totalTimeMs: number;
  dnf?: boolean;
  createdAt: number;
}
