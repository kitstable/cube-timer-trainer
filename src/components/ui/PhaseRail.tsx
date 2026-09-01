import React from 'react';
import type { CFOPPhase, F2LSlotId } from '../../types/cube';
import { COLORS } from '../../utils/constants';

interface PhaseRailProps {
  currentPhase: CFOPPhase;
  solvedSlots: F2LSlotId[];
}

interface SegmentDef {
  id: string;
  color: string;
  isDone: boolean;
  isCurrent: boolean;
}

export const PhaseRail: React.FC<PhaseRailProps> = ({ currentPhase, solvedSlots }) => {
  const isCrossDone = currentPhase !== 'cross';
  const f2lCount = solvedSlots.length;

  const segments: SegmentDef[] = [
    // Cross
    {
      id: 'cross',
      color: COLORS.white,
      isDone: isCrossDone,
      isCurrent: currentPhase === 'cross',
    },
    // F2L 1
    {
      id: 'f2l-1',
      color: COLORS.green,
      isDone: f2lCount >= 1 || ['oll', 'pll', 'auf', 'solved'].includes(currentPhase),
      isCurrent: currentPhase === 'f2l-1',
    },
    // F2L 2
    {
      id: 'f2l-2',
      color: COLORS.red,
      isDone: f2lCount >= 2 || ['oll', 'pll', 'auf', 'solved'].includes(currentPhase),
      isCurrent: currentPhase === 'f2l-2',
    },
    // F2L 3
    {
      id: 'f2l-3',
      color: COLORS.blue,
      isDone: f2lCount >= 3 || ['oll', 'pll', 'auf', 'solved'].includes(currentPhase),
      isCurrent: currentPhase === 'f2l-3',
    },
    // F2L 4
    {
      id: 'f2l-4',
      color: COLORS.orange,
      isDone: f2lCount >= 4 || ['oll', 'pll', 'auf', 'solved'].includes(currentPhase),
      isCurrent: currentPhase === 'f2l-4',
    },
    // OLL
    {
      id: 'oll',
      color: COLORS.yellow,
      isDone: ['pll', 'auf', 'solved'].includes(currentPhase),
      isCurrent: currentPhase === 'oll',
    },
    // PLL
    {
      id: 'pll',
      color: COLORS.purple,
      isDone: currentPhase === 'solved',
      isCurrent: currentPhase === 'pll' || currentPhase === 'auf',
    },
  ];


  return (
    <div className="w-full mb-6">
      <div className="flex gap-1 h-2 rounded-md overflow-hidden mb-2 bg-[var(--surface)] p-0.5 border border-[var(--border)]">
        {segments.map((seg) => {
          let style: React.CSSProperties = {};

          if (seg.isDone) {
            style = { backgroundColor: seg.color, opacity: 1 };
          } else if (seg.isCurrent) {
            style = {
              backgroundColor: seg.color,
              boxShadow: `0 0 0 1px var(--bg), 0 0 0 2px ${seg.color}`,
              opacity: 1,
            };
          } else {
            style = { backgroundColor: 'var(--surface-2)', opacity: 0.5 };
          }

          return (
            <div
              key={seg.id}
              className="flex-1 rounded-sm transition-all duration-300"
              style={style}
            />
          );
        })}
      </div>

      <div className="flex justify-between text-[10px] text-[var(--text-muted)] font-mono px-1">
        <span>cross</span>
        <span>f2l</span>
        <span>oll</span>
        <span>pll</span>
      </div>
    </div>
  );
};
