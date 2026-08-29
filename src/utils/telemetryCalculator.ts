import type { CFOPPhase, TimestampedMove } from '../types/cube';
import type { PhaseSplit } from '../types/db';

export const DEFAULT_PAUSE_THRESHOLD_MS = 800;

export interface SolvedTelemetryResult {
  totalTimeMs: number;
  totalMoves: number;
  overallTps: number;
  overallPauseRatio: number;
  phases: PhaseSplit[];
}

/**
 * Calculates phase splits and telemetry metrics from recorded timestamped moves.
 */
export function calculateSolveTelemetry(
  inspectionDurationMs: number,
  moves: TimestampedMove[],
  totalSolveTimeMs: number,
  isCubeConnected: boolean,
  pauseThresholdMs: number = DEFAULT_PAUSE_THRESHOLD_MS
): SolvedTelemetryResult {
  const totalMoves = moves.length;
  const overallTps = totalSolveTimeMs > 0 ? Number((totalMoves / (totalSolveTimeMs / 1000)).toFixed(2)) : 0;

  if (!isCubeConnected || moves.length === 0) {
    // 2-phase simplified fallback for manual timer
    const phases: PhaseSplit[] = [
      {
        name: 'inspection',
        startTs: 0,
        endTs: inspectionDurationMs,
        moveCount: 0,
      },
      {
        name: 'solve',
        startTs: inspectionDurationMs,
        endTs: inspectionDurationMs + totalSolveTimeMs,
        moveCount: totalMoves,
        tps: overallTps,
      },
    ];

    return {
      totalTimeMs: totalSolveTimeMs,
      totalMoves,
      overallTps,
      overallPauseRatio: 0,
      phases,
    };
  }

  // Smart cube connected: decompose by CFOP phase
  const phaseMap = new Map<CFOPPhase, TimestampedMove[]>();
  const phasesInOrder: CFOPPhase[] = [];

  for (const m of moves) {
    if (!phaseMap.has(m.phase)) {
      phaseMap.set(m.phase, []);
      phasesInOrder.push(m.phase);
    }
    phaseMap.get(m.phase)!.push(m);
  }

  const phaseSplits: PhaseSplit[] = [
    {
      name: 'inspection',
      startTs: 0,
      endTs: inspectionDurationMs,
      moveCount: 0,
    },
  ];

  let cumulativeTimeMs = inspectionDurationMs;
  let totalPauseMs = 0;

  for (const phase of phasesInOrder) {
    if (phase === 'inspection' || phase === 'solved') continue;

    const phaseMoves = phaseMap.get(phase) || [];
    if (phaseMoves.length === 0) continue;

    const moveCount = phaseMoves.length;
    const durationMs = phaseMoves.reduce((acc, m) => acc + m.deltaMs, 0);

    let pauseMs = 0;
    for (const m of phaseMoves) {
      if (m.deltaMs >= pauseThresholdMs) {
        pauseMs += m.deltaMs;
      }
    }

    totalPauseMs += pauseMs;

    const startTs = cumulativeTimeMs;
    const endTs = cumulativeTimeMs + durationMs;
    cumulativeTimeMs = endTs;

    const pauseRatio = durationMs > 0 ? Number((pauseMs / durationMs).toFixed(2)) : 0;
    const tps = durationMs > 0 ? Number((moveCount / (durationMs / 1000)).toFixed(2)) : 0;

    const name = (phase === 'auf' ? 'pll' : phase) as PhaseSplit['name'];

    phaseSplits.push({
      name,
      startTs,
      endTs,
      moveCount,
      tps,
      pauseRatio,
    });
  }

  const overallPauseRatio = totalSolveTimeMs > 0 ? Number((totalPauseMs / totalSolveTimeMs).toFixed(2)) : 0;

  return {
    totalTimeMs: totalSolveTimeMs,
    totalMoves,
    overallTps,
    overallPauseRatio,
    phases: phaseSplits,
  };
}

export function formatTime(ms: number): { seconds: string; millis: string; full: string } {
  if (ms < 0) ms = 0;
  const totalSec = ms / 1000;
  const minutes = Math.floor(totalSec / 60);
  const remSec = Math.floor(totalSec % 60);
  const hundredths = Math.floor((ms % 1000) / 10);

  const paddedHundredths = hundredths.toString().padStart(2, '0');

  if (minutes > 0) {
    const paddedSec = remSec.toString().padStart(2, '0');
    return {
      seconds: `${minutes}:${paddedSec}`,
      millis: paddedHundredths,
      full: `${minutes}:${paddedSec}.${paddedHundredths}`,
    };
  }

  return {
    seconds: `${remSec}`,
    millis: paddedHundredths,
    full: `${remSec}.${paddedHundredths}`,
  };
}
