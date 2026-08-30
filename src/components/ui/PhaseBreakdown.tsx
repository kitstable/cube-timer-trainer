import React from 'react';
import type { PhaseSplit } from '../../types/db';
import { PHASE_COLORS, PHASE_DISPLAY_NAMES } from '../../utils/constants';
import { formatTime } from '../../utils/telemetryCalculator';

interface PhaseBreakdownProps {
  phases: PhaseSplit[];
  totalTimeMs: number;
  totalMoves?: number;
  overallTps?: number;
}

const RECOGNITION_MIN_MS = 150;

/**
 * QiYi-style CFOP phase breakdown for a completed solve — per-phase time, proportion,
 * move count, TPS, and the between-phase recognition/thinking gap. Shared by the Timed
 * Solve result panel and the History detail modal so the two can't drift.
 */
export const PhaseBreakdown: React.FC<PhaseBreakdownProps> = ({
  phases,
  totalTimeMs,
  totalMoves,
  overallTps,
}) => {
  if (!phases || phases.length === 0) return null;

  const solveMs =
    phases
      .filter((p) => p.name !== 'inspection')
      .reduce((acc, p) => acc + Math.max(0, p.endTs - p.startTs), 0) || totalTimeMs;

  return (
    <div className="font-mono text-[13px]">
      {phases.map((p, idx) => {
        const dur = Math.max(0, p.endTs - p.startTs);
        const color = PHASE_COLORS[p.name] || 'var(--text-muted)';
        const name = (PHASE_DISPLAY_NAMES as Record<string, string>)[p.name] || p.name;
        const isInspection = p.name === 'inspection';
        const proportion = !isInspection && solveMs > 0 ? (dur / solveMs) * 100 : null;
        const recognition = p.recognitionMs ?? 0;

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
              <span className="font-tabular text-[var(--text)] shrink-0">
                {(dur / 1000).toFixed(2)}s
              </span>
            </div>

            {meta.length > 0 && (
              <div className="pl-[18px] mt-0.5 text-[11px] text-[var(--text-muted)]">
                {meta.join(' · ')}
              </div>
            )}

            {recognition >= RECOGNITION_MIN_MS && (
              <div className="pl-[18px] mt-0.5 text-[11px] text-[var(--orange)]/80">
                +{(recognition / 1000).toFixed(1)}s recognition
              </div>
            )}
          </div>
        );
      })}

      {(totalMoves || overallTps) && (
        <div className="flex items-center justify-between gap-3 pt-2 px-1 text-[11px] text-[var(--text-muted)]">
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
