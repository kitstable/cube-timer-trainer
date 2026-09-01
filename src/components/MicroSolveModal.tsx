import React, { useEffect } from 'react';
import { HelpCircle } from 'lucide-react';
import { formatTime } from '../utils/telemetryCalculator';

interface MicroSolveModalProps {
  isOpen: boolean;
  moveCount: number;
  timeMs: number;
  onSave: () => void;
  onDiscard: () => void;
}

export const MicroSolveModal: React.FC<MicroSolveModalProps> = ({
  isOpen,
  moveCount,
  timeMs,
  onSave,
  onDiscard,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onDiscard();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onDiscard]);

  if (!isOpen) return null;

  const formatted = formatTime(timeMs);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onDiscard();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="micro-solve-title"
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm p-5 text-[var(--text)] shadow-2xl animate-in fade-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-2">
          <HelpCircle className="w-5 h-5 text-[var(--orange)] shrink-0" />
          <h2 id="micro-solve-title" className="font-heading font-semibold text-base">
            Micro-Solve Detected
          </h2>
        </div>

        <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">
          Completed in <strong className="text-[var(--text)] font-mono">{moveCount} {moveCount === 1 ? 'move' : 'moves'}</strong> ({formatted.full}s). Would you like to save this solve to history or discard it?
        </p>

        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={onSave}
            className="w-full py-2.5 rounded-xl font-heading font-semibold text-sm bg-[var(--white)] text-[var(--bg)] hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
          >
            Save to History
          </button>

          <button
            type="button"
            onClick={onDiscard}
            className="w-full py-2.5 rounded-xl font-heading font-medium text-sm bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 border border-[var(--border)] text-[var(--red)] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            Discard Solve
          </button>
        </div>
      </div>
    </div>
  );
};
