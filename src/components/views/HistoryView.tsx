import React, { useEffect, useState } from 'react';
import { Trash2, ChevronRight, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getSolvesByProfile, deleteSolve, calculateSessionStats, type SessionStats } from '../../db/repository';
import type { Solve } from '../../types/db';
import { formatTime } from '../../utils/telemetryCalculator';
import { PhaseBreakdown } from '../ui/PhaseBreakdown';

export const HistoryView: React.FC = () => {
  const { currentProfileId } = useAppStore();
  const [solves, setSolves] = useState<Solve[]>([]);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [selectedSolve, setSelectedSolve] = useState<Solve | null>(null);

  const loadHistory = async () => {
    try {
      const data = await getSolvesByProfile(currentProfileId);
      setSolves(data);
      setStats(calculateSessionStats(data));
    } catch (err) {
      console.warn('Failed to load solve history:', err);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [currentProfileId]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this solve?')) {
      await deleteSolve(id);
      if (selectedSolve?.id === id) setSelectedSolve(null);
      await loadHistory();
    }
  };

  return (
    <div className="flex flex-col flex-1 pb-4">
      <div className="mb-3">
        <h1 className="font-heading font-semibold text-xl tracking-tight text-[var(--text)]">
          Solves & History
        </h1>
        <div className="text-xs text-[var(--text-muted)] font-sans">
          Stored locally in IndexedDB
        </div>
      </div>

      {/* Session Stats Grid */}
      {stats && stats.count > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-2.5 text-center">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-0.5">
              Ao5
            </div>
            <div className="font-mono text-base font-semibold text-[var(--text)] font-tabular">
              {stats.ao5 ? `${(stats.ao5 / 1000).toFixed(2)}s` : '—'}
            </div>
          </div>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-2.5 text-center">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-0.5">
              Best
            </div>
            <div className="font-mono text-base font-semibold text-[var(--green)] font-tabular">
              {stats.best ? `${(stats.best / 1000).toFixed(2)}s` : '—'}
            </div>
          </div>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-2.5 text-center">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-0.5">
              Mean
            </div>
            <div className="font-mono text-base font-semibold text-[var(--text)] font-tabular">
              {stats.mean ? `${(stats.mean / 1000).toFixed(2)}s` : '—'}
            </div>
          </div>
        </div>
      )}

      {/* Solves List */}
      <div className="flex-1 overflow-y-auto max-h-[380px] bg-[var(--surface)] border border-[var(--border)] rounded-2xl divide-y divide-[var(--border)] mb-4">
        {solves.length === 0 ? (
          <div className="py-12 text-center text-xs text-[var(--text-muted)]">
            No solves recorded yet. Complete a timed solve to see history!
          </div>
        ) : (
          solves.map((solve, index) => {
            const timeObj = formatTime(solve.totalTimeMs);
            const dateStr = new Date(solve.createdAt).toLocaleDateString([], {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={solve.id}
                onClick={() => setSelectedSolve(solve)}
                className="flex items-center justify-between p-3 hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-[var(--text-muted)] w-5">
                    #{solves.length - index}
                  </span>
                  <div>
                    <div className="font-mono text-base font-medium text-[var(--text)] font-tabular">
                      {timeObj.seconds}.<span className="text-xs text-[var(--text-muted)]">{timeObj.millis}</span>
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5 mt-0.5">
                      <span>{dateStr}</span>
                      {solve.cubeConnected && (
                        <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] bg-[var(--surface-2)] text-[var(--green)] border border-[var(--border)]">
                          Smart Cube
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => handleDelete(solve.id, e)}
                    className="p-1.5 text-[var(--text-muted)] hover:text-[var(--red)] transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Solve Detail Modal */}
      {selectedSolve && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm p-4 text-[var(--text)] shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-heading font-semibold text-base">Solve Details</h2>
              <button
                onClick={() => setSelectedSolve(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-center py-3 bg-[var(--surface-2)] rounded-xl mb-3">
              <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">
                Total Time
              </div>
              <div className="font-mono text-3xl font-semibold font-tabular">
                {formatTime(selectedSolve.totalTimeMs).full}s
              </div>
            </div>

            {/* Phase Splits */}
            <div className="space-y-1.5 mb-4 max-h-[220px] overflow-y-auto">
              <div className="text-[11px] font-heading font-medium text-[var(--text-muted)] uppercase tracking-wider px-1">
                Phase Breakdown
              </div>
              {selectedSolve.phases && selectedSolve.phases.length > 0 ? (
                <PhaseBreakdown
                  phases={selectedSolve.phases}
                  totalTimeMs={selectedSolve.totalTimeMs}
                  totalMoves={selectedSolve.cubeConnected ? selectedSolve.totalMoves : undefined}
                  overallTps={selectedSolve.cubeConnected ? selectedSolve.overallTps : undefined}
                />
              ) : (
                <div className="text-xs text-[var(--text-muted)] text-center py-2">
                  No phase telemetry recorded for this solve.
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedSolve(null)}
              className="w-full py-2.5 rounded-xl font-heading font-semibold text-sm bg-[var(--white)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
