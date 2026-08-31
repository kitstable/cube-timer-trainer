import React, { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';

interface StopSolveModalProps {
  isOpen: boolean;
  onSaveDnf: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export const StopSolveModal: React.FC<StopSolveModalProps> = ({
  isOpen,
  onSaveDnf,
  onDiscard,
  onCancel,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stop-solve-title"
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm p-5 text-[var(--text)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-2">
          <AlertCircle className="w-5 h-5 text-[var(--orange)] shrink-0" />
          <h2 id="stop-solve-title" className="font-heading font-semibold text-base">
            Stop timed solve?
          </h2>
        </div>

        <p className="text-xs text-[var(--text-muted)] mb-5">
          The current solve will be marked as DNF.
        </p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onSaveDnf}
            className="w-full py-2.5 rounded-xl font-heading font-semibold text-sm bg-[var(--red)] text-white hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
          >
            Save DNF
          </button>

          <button
            type="button"
            onClick={onDiscard}
            className="w-full py-2.5 rounded-xl font-heading font-medium text-sm bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 border border-[var(--border)] text-[var(--text)] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            Stop without saving
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="w-full py-2.5 rounded-xl font-heading font-medium text-sm bg-transparent text-[var(--text-muted)] hover:text-[var(--text)] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
