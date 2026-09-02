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
  plusTwo?: boolean;
  createdAt: number;
}

export type TrainingPhase = 'OLL' | 'PLL' | 'F2L' | 'cross';

/**
 * One completed Training-mode rep. Kept in its own Dexie table (not appended to `Solve`)
 * so it never bloats the `getSolvesByProfile` full-scan that runs on every History/stats
 * render. Populated for both smart-cube and on-screen (no-cube) reps.
 */
export interface TrainingRep {
  id: string;
  profileId: string;
  phase: TrainingPhase;
  /** Drill method within the phase, e.g. "full" or a 2-Look drill id ("oll-corners"). */
  method?: string;
  /** CFOP case name drilled (e.g. "OLL-21 Antisune"). Empty for Cross. */
  caseName: string;
  /** F2L slot when phase === 'F2L'. */
  slot?: string;
  /** Physical/tapped moves of the solve attempt (not the setup scramble). */
  moves: string[];
  /** Attempt duration in ms (from first move / entering attempt, to completion). */
  timeMs: number;
  /** Whether the rep was solved (vs. skipped / gave up). */
  success: boolean;
  /** True if a smart cube drove the rep. */
  cubeConnected: boolean;
  createdAt: number;
}

/**
 * Calculates the effective solve time in milliseconds taking +2 penalty into account.
 */
export function getEffectiveTimeMs(solve: { totalTimeMs: number; plusTwo?: boolean }): number {
  return solve.totalTimeMs + (solve.plusTwo ? 2000 : 0);
}

