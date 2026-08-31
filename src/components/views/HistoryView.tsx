import React, { useEffect, useState } from 'react';
import { Trash2, ChevronRight, X, Clock, BarChart2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getSolvesByProfile, deleteSolve, calculateSessionStats, type SessionStats } from '../../db/repository';
import type { Solve } from '../../types/db';
import { formatTime } from '../../utils/telemetryCalculator';
import { PhaseBreakdown } from '../ui/PhaseBreakdown';
import { useIsDesktop } from '../../hooks/useMediaQuery';

export const HistoryView: React.FC = () => {
  const { currentProfileId } = useAppStore();
  const isDesktop = useIsDesktop();
  const [solves, setSolves] = useState<Solve[]>([]);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [selectedSolve, setSelectedSolve] = useState<Solve | null>(null);

  const loadHistory = async () => {
    try {
      const data = await getSolvesByProfile(currentProfileId);
      setSolves(data);
      setStats(calculateSessionStats(data));
      // Auto-select latest solve on desktop if none selected
      if (data.length > 0 && isDesktop) {
        setSelectedSolve((prev) => prev ?? data[0]);
      }
    } catch (err) {
      console.warn('Failed to load solve history:', err);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [currentProfileId, isDesktop]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this solve?')) {
      await deleteSolve(id);
      if (selectedSolve?.id === id) setSelectedSolve(null);
      await loadHistory();
    }
  };

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-12 lg:gap-8 flex-1 pb-4">
      {/* Mobile Title Bar */}
      <div className="flex lg:hidden mb-3 items-center justify-between">
        <div>
          <h1 className="font-heading font-semibold text-xl tracking-tight text-[var(--text)]">
            Solves & History
          </h1>
          <div className="text-xs text-[var(--text-muted)] font-sans">
            Stored locally in IndexedDB
          </div>
        </div>
      </div>

      {/* LEFT COLUMN: Stats Summary & Solve Inspector Panel */}
      <div className="lg:col-span-5 xl:col-span-5 flex flex-col gap-3 mb-3 lg:mb-0">
        {/* Session Stats Grid */}
        {stats && stats.count > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-0.5">
                Ao5
              </div>
              <div className="font-mono text-lg font-semibold text-[var(--text)] font-tabular">
                {stats.ao5 ? `${(stats.ao5 / 1000).toFixed(2)}s` : '—'}
              </div>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-0.5">
                Best
              </div>
              <div className="font-mono text-lg font-semibold text-[var(--green)] font-tabular">
                {stats.best ? `${(stats.best / 1000).toFixed(2)}s` : '—'}
              </div>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-0.5">
                Mean
              </div>
              <div className="font-mono text-lg font-semibold text-[var(--text)] font-tabular">
                {stats.mean ? `${(stats.mean / 1000).toFixed(2)}s` : '—'}
              </div>
            </div>
          </div>
        )}

        {/* Desktop Solve Inspector Card */}
        <div className="hidden lg:flex flex-col flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
          {selectedSolve ? (
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--border)]/60">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[var(--text-muted)]" />
                  <span className="font-heading font-semibold text-sm">Solve Details</span>
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {new Date(selectedSolve.createdAt).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>

              {/* Time Display */}
              <div className="text-center py-3 bg-[var(--surface-2)] rounded-xl mb-3">
                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-0.5">
                  Total Time
                </div>
                <div className="font-mono text-3xl font-bold font-tabular text-[var(--text)]">
                  {formatTime(selectedSolve.totalTimeMs).full}s
                </div>
                {selectedSolve.cubeConnected && (
                  <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--surface)] text-[var(--green)] border border-[var(--border)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
                    <span>Smart Cube Solve</span>
                  </div>
                )}
              </div>

              {/* Phase Splits */}
              <div className="space-y-1.5 flex-1 overflow-y-auto max-h-[300px]">
                <div className="text-[11px] font-heading font-medium text-[var(--text-muted)] uppercase tracking-wider px-1 mb-1">
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
                  <div className="text-xs text-[var(--text-muted)] text-center py-6">
                    No CFOP phase telemetry recorded for this manual solve.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 text-center p-6 text-[var(--text-muted)]">
              <BarChart2 className="w-8 h-8 mb-2 opacity-50" />
              <div className="font-heading font-medium text-sm text-[var(--text)] mb-1">
                Solve Inspector
              </div>
              <div className="text-xs max-w-[220px]">
                Select a solve from the list on the right to inspect phase splits and telemetry.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: Header & Solves List */}
      <div className="lg:col-span-7 xl:col-span-7 flex flex-col justify-between">
        {/* Desktop Header */}
        <div className="hidden lg:flex items-center justify-between mb-3 pb-2 border-b border-[var(--border)]/50">
          <div>
            <h1 className="font-heading font-semibold text-2xl tracking-tight text-[var(--text)]">
              Solves & History
            </h1>
            <div className="text-xs text-[var(--text-muted)] mt-0.5">
              {solves.length} solves recorded · Stored locally in IndexedDB
            </div>
          </div>
        </div>

        {/* Solves List */}
        <div className="flex-1 overflow-y-auto max-h-[380px] lg:max-h-[520px] bg-[var(--surface)] border border-[var(--border)] rounded-2xl divide-y divide-[var(--border)] mb-2">
          {solves.length === 0 ? (
            <div className="py-16 text-center text-xs text-[var(--text-muted)]">
              No solves recorded yet. Complete a timed solve to see history!
            </div>
          ) : (
            solves.map((solve, index) => {
              const timeObj = formatTime(solve.totalTimeMs);
              const isSelected = selectedSolve?.id === solve.id;
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
                  className={`flex items-center justify-between p-3.5 transition-colors cursor-pointer ${
                    isSelected && isDesktop
                      ? 'bg-[var(--surface-2)] ring-1 ring-[var(--green)]/30'
                      : 'hover:bg-[var(--surface-2)]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-[var(--text-muted)] w-6">
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
                      title="Delete solve"
                      className="p-1.5 text-[var(--text-muted)] hover:text-[var(--red)] transition-colors cursor-pointer rounded-lg hover:bg-[var(--border)]/50"
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
      </div>

      {/* Mobile-Only Solve Detail Modal */}
      {!isDesktop && selectedSolve && (
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
