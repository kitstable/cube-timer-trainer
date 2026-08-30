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
  /**
   * Idle time (ms) before this phase's first recorded move — the between-phase
   * recognition/thinking gap. Only set for smart-cube solves. `0` for the first phase.
   */
  recognitionMs?: number;
}

export interface Solve {
  id: string;
  profileId: string;
  scrambleMoves: string[];
  mode: 'timed' | 'guided';
  cubeConnected: boolean;
  phases: PhaseSplit[];
  totalTimeMs: number;
  /** Total physical moves in the solve (smart-cube solves only). */
  totalMoves?: number;
  /** Overall turns per second over the whole solve (smart-cube solves only). */
  overallTps?: number;
  dnf?: boolean;
  createdAt: number;
}
