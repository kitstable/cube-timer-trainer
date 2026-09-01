import React from 'react';
import type { PhaseSplit } from '../../types/db';
import { PHASE_COLORS, PHASE_DISPLAY_NAMES, COLORS } from '../../utils/constants';
import { formatTime } from '../../utils/telemetryCalculator';

interface PhaseBreakdownProps {
  phases: PhaseSplit[];
  totalTimeMs: number;
  totalMoves?: number;
  overallTps?: number;
}

const RECOGNITION_MIN_MS = 150;

/**
 * CFOP phase breakdown for a completed solve — high-level stage groupings (Cross, F2L, OLL, PLL),
 * per-phase duration (including recognition and solving), move counts, TPS, and explicit
 * recognition (thinking) vs execution (solving) splits.
 */
export const PhaseBreakdown: React.FC<PhaseBreakdownProps> = ({
  phases,
  totalTimeMs,
  totalMoves,
  overallTps,
}) => {
  if (!phases || phases.length === 0) return null;

  const solvePhases = phases.filter((p) => p.name !== 'inspection');
  const solveMs =
    solvePhases.reduce((acc, p) => acc + Math.max(0, p.endTs - p.startTs), 0) || totalTimeMs;

  const isCfopDecomposed = solvePhases.length > 1 && solvePhases.some((p) => p.name.startsWith('f2l') || p.name === 'oll' || p.name === 'pll');

  // Compute high-level CFOP Stage Groupings (Cross, F2L 1-4, OLL, PLL)
  const cfopGroups = isCfopDecomposed
    ? [
        {
          key: 'cross',
          label: 'Cross',
          color: COLORS.white,
          timeMs: phases.filter((p) => p.name === 'cross').reduce((acc, p) => acc + Math.max(0, p.endTs - p.startTs), 0),
          moves: phases.filter((p) => p.name === 'cross').reduce((acc, p) => acc + p.moveCount, 0),
        },
        {
          key: 'f2l',
          label: 'F2L',
          color: COLORS.green,
          timeMs: phases.filter((p) => p.name.startsWith('f2l')).reduce((acc, p) => acc + Math.max(0, p.endTs - p.startTs), 0),
          moves: phases.filter((p) => p.name.startsWith('f2l')).reduce((acc, p) => acc + p.moveCount, 0),
        },
        {
          key: 'oll',
          label: 'OLL',
          color: COLORS.yellow,
          timeMs: phases.filter((p) => p.name === 'oll').reduce((acc, p) => acc + Math.max(0, p.endTs - p.startTs), 0),
          moves: phases.filter((p) => p.name === 'oll').reduce((acc, p) => acc + p.moveCount, 0),
        },
        {
          key: 'pll',
          label: 'PLL',
          color: COLORS.purple,
          timeMs: phases.filter((p) => p.name === 'pll').reduce((acc, p) => acc + Math.max(0, p.endTs - p.startTs), 0),
          moves: phases.filter((p) => p.name === 'pll').reduce((acc, p) => acc + p.moveCount, 0),
        },
      ].filter((g) => g.timeMs > 0)

    : [];

  return (
    <div className="font-mono text-[13px]">
      {/* High-Level CFOP Stage Summary (Cross, F2L, OLL, PLL) */}
      {cfopGroups.length > 0 && (
        <div className="mb-3">
          {/* Segmented stage proportion bar */}
          <div className="flex h-1.5 rounded-full overflow-hidden mb-2 bg-[var(--surface-2)]">
            {cfopGroups.map((g) => {
              const pct = solveMs > 0 ? (g.timeMs / solveMs) * 100 : 0;
              return (
                <div
                  key={g.key}
                  title={`${g.label}: ${(g.timeMs / 1000).toFixed(2)}s (${pct.toFixed(1)}%)`}
                  style={{ width: `${pct}%`, backgroundColor: g.color }}
                  className="h-full first:rounded-l-full last:rounded-r-full transition-all"
                />
              );
            })}
          </div>

          {/* 4-Stage Summary Cards */}
          <div className="grid grid-cols-4 gap-1.5 p-2 bg-[var(--surface-2)]/60 border border-[var(--border)]/70 rounded-xl text-center">
            {cfopGroups.map((g) => {
              const pct = solveMs > 0 ? (g.timeMs / solveMs) * 100 : 0;
              return (
                <div key={g.key} className="flex flex-col items-center">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                    <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-heading font-medium">
                      {g.label}
                    </span>
                  </div>
                  <div className="font-mono text-xs font-semibold text-[var(--text)] font-tabular">
                    {(g.timeMs / 1000).toFixed(2)}s
                  </div>
                  <div className="font-mono text-[10px] text-[var(--text-muted)] font-tabular">
                    {pct.toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Individual Phase Splits */}
      <div className="divide-y divide-[var(--border)]">
        {phases.map((p, idx) => {
          const dur = Math.max(0, p.endTs - p.startTs);
          const color = PHASE_COLORS[p.name] || 'var(--text-muted)';
          const name = (PHASE_DISPLAY_NAMES as Record<string, string>)[p.name] || p.name;
          const isInspection = p.name === 'inspection';
          const proportion = !isInspection && solveMs > 0 ? (dur / solveMs) * 100 : null;
          const recognition = p.recognitionMs ?? 0;
          const solving = Math.max(0, dur - recognition);

          const meta: string[] = [];
          if (proportion !== null) meta.push(`${proportion.toFixed(1)}%`);
          if (!isInspection && p.moveCount > 0) meta.push(`${p.moveCount} moves`);
          if (p.tps !== undefined && p.tps > 0) meta.push(`${p.tps.toFixed(2)} TPS`);

          return (
            <div
              key={idx}
              className="py-2 px-1 border-b border-[var(--border)] last:border-b-0"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-2 h-2 rounded-[2px] shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-sans text-[var(--text)] truncate">{name}</span>
                </div>
                <span className="font-tabular text-[var(--text)] shrink-0 font-medium">
                  {(dur / 1000).toFixed(2)}s
                </span>
              </div>

              {meta.length > 0 && (
                <div className="pl-[18px] mt-0.5 text-[11px] text-[var(--text-muted)]">
                  {meta.join(' · ')}
                </div>
              )}

              {/* Explicit Recognition vs Solving Time Breakdown */}
              {!isInspection && recognition >= RECOGNITION_MIN_MS && (
                <div className="pl-[18px] mt-1 text-[11px] text-[var(--text-muted)] flex items-center gap-1.5 flex-wrap">
                  <span className="text-[var(--orange)]">
                    Recognition: <strong>{(recognition / 1000).toFixed(2)}s</strong>
                  </span>
                  <span>·</span>
                  <span className="text-[var(--text)]">
                    Solving: <strong>{(solving / 1000).toFixed(2)}s</strong>
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    ({((recognition / dur) * 100).toFixed(0)}% rec / {((solving / dur) * 100).toFixed(0)}% solve)
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(totalMoves || overallTps) && (
        <div className="flex items-center justify-between gap-3 pt-2 px-1 text-[11px] text-[var(--text-muted)] border-t border-[var(--border)] mt-1">
          <span className="font-sans">
            {totalMoves ? `${totalMoves} moves` : ''}
            {totalMoves && overallTps ? ' · ' : ''}
            {overallTps ? `${overallTps.toFixed(2)} TPS avg` : ''}
          </span>
          <span className="font-tabular">{formatTime(totalTimeMs).full}s</span>
        </div>
      )}
    </div>
  );
};

