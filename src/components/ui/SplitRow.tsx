import React from 'react';

interface SplitRowProps {
  color: string;
  name: string;
  timeStr: string;
  isRunning?: boolean;
  tps?: number;
}

export const SplitRow: React.FC<SplitRowProps> = ({
  color,
  name,
  timeStr,
  isRunning = false,
  tps,
}) => {
  return (
    <div className="flex items-center justify-between py-2.5 px-3 font-mono text-[13px] border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-center gap-2.5">
        <span
          className="w-2 h-2 rounded-[2px] shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="font-sans text-[13px] text-[var(--text-muted)]">
          {name} {isRunning && <span className="text-[var(--text)] italic text-xs">— running</span>}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {tps !== undefined && tps > 0 && (
          <span className="text-[11px] text-[var(--text-muted)] font-mono">{tps.toFixed(1)} TPS</span>
        )}
        <span className={`font-mono ${isRunning ? 'text-[var(--green)] animate-pulse' : 'text-[var(--text)]'}`}>
          {isRunning ? '…' : timeStr}
        </span>
      </div>
    </div>
  );
};
