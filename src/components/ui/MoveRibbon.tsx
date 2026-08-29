import React from 'react';

interface MoveRibbonProps {
  moves: string[];
  activeIndex?: number;
  label?: string;
  className?: string;
}

export const MoveRibbon: React.FC<MoveRibbonProps> = ({
  moves,
  activeIndex = 0,
  label = 'Next moves',
  className = '',
}) => {
  if (moves.length === 0) {
    return (
      <div className={`text-center my-4 ${className}`}>
        {label && <div className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5 font-sans font-medium">{label}</div>}
        <div className="font-mono text-xl text-[var(--green)]">Cube is in position</div>
      </div>
    );
  }

  return (
    <div className={`text-center my-4 ${className}`}>
      {label && (
        <div className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5 font-sans font-medium">
          {label}
        </div>
      )}
      <div className="font-mono text-2xl font-medium tracking-wide flex flex-wrap items-center justify-center gap-2">
        {moves.map((move, idx) => {
          if (idx < activeIndex) {
            return (
              <span key={idx} className="text-[var(--text-muted)] opacity-60">
                {move}
              </span>
            );
          }
          if (idx === activeIndex) {
            return (
              <span
                key={idx}
                className="bg-[var(--white)] text-[var(--bg)] font-bold px-2 py-0.5 rounded-md shadow-xs"
              >
                {move}
              </span>
            );
          }
          return (
            <span key={idx} className="text-[var(--text)]">
              {move}
            </span>
          );
        })}
      </div>
    </div>
  );
};
