import React, { useEffect, useState, useMemo } from 'react';
import { Trash2, ChevronRight, X, Clock, BarChart2, Trophy, Download, ArrowUpDown } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
  getSolvesByProfile,
  deleteSolve,
  updateSolve,
  clearSolvesByProfile,
  calculateSessionStats,
  getAllProfiles,
  type SessionStats,
} from '../../db/repository';
import { getEffectiveTimeMs, type Solve } from '../../types/db';
import { formatTime } from '../../utils/telemetryCalculator';
import { PhaseBreakdown } from '../ui/PhaseBreakdown';
import { useIsDesktop } from '../../hooks/useMediaQuery';

export type SortOption = 'date-desc' | 'date-asc' | 'time-asc' | 'time-desc';

function exportSolvesCSV(solves: Solve[], profileName: string) {
  const headers = ['Index', 'Time (s)', 'Penalty', 'Raw Time (ms)', 'Moves', 'TPS', 'Date', 'Scramble'];
  const rows = solves.map((s, idx) => {
    const penalty = s.dnf ? 'DNF' : s.plusTwo ? '+2' : 'OK';
    const effectiveSec = s.dnf ? 'DNF' : (getEffectiveTimeMs(s) / 1000).toFixed(2);
    const moves = s.totalMoves ?? '';
    const tps = s.overallTps ?? '';
    const date = new Date(s.createdAt).toISOString();
    const scramble = s.scrambleMoves.join(' ');
    return [solves.length - idx, effectiveSec, penalty, s.totalTimeMs, moves, tps, date, `"${scramble}"`].join(',');
  });
  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `solves_${profileName.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export const HistoryView: React.FC = () => {
  const { currentProfileId } = useAppStore();
  const isDesktop = useIsDesktop();
  const [solves, setSolves] = useState<Solve[]>([]);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [selectedSolve, setSelectedSolve] = useState<Solve | null>(null);
  const [profileName, setProfileName] = useState('Profile');
  const [sortBy, setSortBy] = useState<SortOption>('date-desc');

  const loadHistory = async () => {
    try {
      const data = await getSolvesByProfile(currentProfileId);
      setSolves(data);
      const computedStats = calculateSessionStats(data);
      setStats(computedStats);

      const allProfiles = await getAllProfiles();
      const curr = allProfiles.find((p) => p.id === currentProfileId);
      if (curr) setProfileName(curr.name);

      // Auto-select latest solve on desktop if none selected
      if (data.length > 0 && isDesktop) {
        setSelectedSolve((prev) => (prev ? data.find((s) => s.id === prev.id) ?? data[0] : data[0]));
      }
    } catch (err) {
      console.warn('Failed to load solve history:', err);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [currentProfileId, isDesktop]);

  const sortedSolves = useMemo(() => {
    // Attach original chronological solve number (#1 is first recorded solve, #N is latest)
    const tagged = solves.map((s, idx) => ({
      ...s,
      solveNumber: solves.length - idx,
    }));

    return [...tagged].sort((a, b) => {
      if (sortBy === 'date-desc') {
        return b.createdAt - a.createdAt;
      }
      if (sortBy === 'date-asc') {
        return a.createdAt - b.createdAt;
      }
      if (sortBy === 'time-asc') {
        // Fastest first (DNFs at bottom)
        if (a.dnf && !b.dnf) return 1;
        if (!a.dnf && b.dnf) return -1;
        if (a.dnf && b.dnf) return b.createdAt - a.createdAt;
        return getEffectiveTimeMs(a) - getEffectiveTimeMs(b);
      }
      if (sortBy === 'time-desc') {
        // Slowest first (DNFs at top)
        if (a.dnf && !b.dnf) return -1;
        if (!a.dnf && b.dnf) return 1;
        if (a.dnf && b.dnf) return b.createdAt - a.createdAt;
        return getEffectiveTimeMs(b) - getEffectiveTimeMs(a);
      }
      return 0;
    });
  }, [solves, sortBy]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this solve?')) {
      await deleteSolve(id);
      if (selectedSolve?.id === id) setSelectedSolve(null);
      await loadHistory();
    }
  };

  const handleClearHistory = async () => {
    if (solves.length === 0) return;
    if (confirm(`Clear all ${solves.length} solves for ${profileName}? This cannot be undone.`)) {
      await clearSolvesByProfile(currentProfileId);
      setSelectedSolve(null);
      await loadHistory();
    }
  };

  const handleSetPenalty = async (solveId: string, penalty: 'none' | '+2' | 'dnf') => {
    const updates: Partial<Solve> = {
      plusTwo: penalty === '+2',
      dnf: penalty === 'dnf',
    };
    try {
      await updateSolve(solveId, updates);
      if (selectedSolve?.id === solveId) {
        setSelectedSolve((prev) => (prev ? { ...prev, ...updates } : null));
      }
      await loadHistory();
    } catch (err) {
      console.error('Failed to update penalty:', err);
    }
  };

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-12 lg:gap-8 flex-1 pb-4">
      {/* Mobile Title Bar */}
      <div className="flex lg:hidden flex-col gap-2 mb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading font-semibold text-xl tracking-tight text-[var(--text)]">
              Solves & History
            </h1>
            <div className="text-xs text-[var(--text-muted)] font-sans">
              {solves.length} {solves.length === 1 ? 'solve' : 'solves'} · {profileName}
            </div>
          </div>

          {solves.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => exportSolvesCSV(solves, profileName)}
                title="Export CSV"
                className="p-2 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors rounded-lg bg-[var(--surface)] border border-[var(--border)] cursor-pointer"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Mobile Sort Bar */}
        {solves.length > 0 && (
          <div className="flex items-center gap-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-xl px-2.5 py-1.5">
            <ArrowUpDown className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="bg-transparent text-xs text-[var(--text)] focus:outline-hidden cursor-pointer flex-1"
            >
              <option value="date-desc" className="bg-[var(--surface)] text-[var(--text)]">Sort: Date (Newest First)</option>
              <option value="date-asc" className="bg-[var(--surface)] text-[var(--text)]">Sort: Date (Oldest First)</option>
              <option value="time-asc" className="bg-[var(--surface)] text-[var(--text)]">Sort: Time (Fastest First)</option>
              <option value="time-desc" className="bg-[var(--surface)] text-[var(--text)]">Sort: Time (Slowest First)</option>
            </select>
          </div>
        )}
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
                Best (PB)
              </div>
              <div className="font-mono text-lg font-semibold text-[var(--purple)] font-tabular flex items-center justify-center gap-1">
                <Trophy className="w-3.5 h-3.5 text-[var(--purple)] shrink-0" />
                <span>{stats.best ? `${(stats.best / 1000).toFixed(2)}s` : '—'}</span>
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
                  {selectedSolve.id === stats?.bestSolveId && !selectedSolve.dnf && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-heading font-semibold bg-[var(--purple)]/15 text-[var(--purple)] border border-[var(--purple)]/30">
                      <Trophy className="w-3 h-3 fill-[var(--purple)]" />
                      <span>PB</span>
                    </span>
                  )}
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
                {selectedSolve.dnf ? (
                  <div>
                    <div className="font-mono text-3xl font-bold font-tabular text-[var(--red)]">
                      DNF
                    </div>
                    <div className="text-xs font-mono text-[var(--text-muted)] mt-0.5">
                      ({formatTime(selectedSolve.totalTimeMs).full}s)
                    </div>
                  </div>
                ) : (
                  <div className="font-mono text-3xl font-bold font-tabular text-[var(--text)]">
                    {formatTime(getEffectiveTimeMs(selectedSolve)).full}s
                    {selectedSolve.plusTwo && (
                      <span className="text-base text-[var(--orange)] ml-1 font-normal">+2</span>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-center gap-1.5 mt-1.5 flex-wrap">
                  {selectedSolve.id === stats?.bestSolveId && !selectedSolve.dnf && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--purple)]/15 text-[var(--purple)] border border-[var(--purple)]/30">
                      Personal Best
                    </span>
                  )}
                  {selectedSolve.dnf && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--red)]/15 text-[var(--red)] border border-[var(--red)]/30">
                      DNF
                    </span>
                  )}

                  {selectedSolve.plusTwo && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--orange)]/15 text-[var(--orange)] border border-[var(--orange)]/30">
                      +2 Penalty
                    </span>
                  )}
                  {selectedSolve.cubeConnected && (
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--surface)] text-[var(--green)] border border-[var(--border)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
                      <span>Smart Cube</span>
                    </div>
                  )}
                </div>

                {/* Penalty Toggle Buttons */}
                <div className="grid grid-cols-3 gap-1.5 mt-3 max-w-[240px] mx-auto">
                  <button
                    onClick={() => handleSetPenalty(selectedSolve.id, 'none')}
                    className={`py-1 rounded-lg text-[11px] font-mono font-medium transition-colors cursor-pointer border ${
                      !selectedSolve.plusTwo && !selectedSolve.dnf
                        ? 'bg-[var(--white)] text-[var(--bg)] border-[var(--white)] font-semibold'
                        : 'bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] border-[var(--border)]'
                    }`}
                  >
                    OK
                  </button>
                  <button
                    onClick={() => handleSetPenalty(selectedSolve.id, '+2')}
                    className={`py-1 rounded-lg text-[11px] font-mono font-medium transition-colors cursor-pointer border ${
                      selectedSolve.plusTwo
                        ? 'bg-[var(--orange)] text-white border-[var(--orange)] font-semibold'
                        : 'bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] border-[var(--border)]'
                    }`}
                  >
                    +2
                  </button>
                  <button
                    onClick={() => handleSetPenalty(selectedSolve.id, 'dnf')}
                    className={`py-1 rounded-lg text-[11px] font-mono font-medium transition-colors cursor-pointer border ${
                      selectedSolve.dnf
                        ? 'bg-[var(--red)] text-white border-[var(--red)] font-semibold'
                        : 'bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] border-[var(--border)]'
                    }`}
                  >
                    DNF
                  </button>
                </div>
              </div>

              {/* Phase Splits */}
              <div className="space-y-1.5 flex-1 overflow-y-auto max-h-[300px]">
                <div className="text-[11px] font-heading font-medium text-[var(--text-muted)] uppercase tracking-wider px-1 mb-1">
                  Phase Breakdown
                </div>
                {selectedSolve.phases && selectedSolve.phases.length > 0 ? (
                  <PhaseBreakdown
                    phases={selectedSolve.phases}
                    totalTimeMs={getEffectiveTimeMs(selectedSolve)}
                    totalMoves={selectedSolve.cubeConnected ? selectedSolve.totalMoves : undefined}
                    overallTps={selectedSolve.cubeConnected ? selectedSolve.overallTps : undefined}
                  />
                ) : (
                  <div className="text-xs text-[var(--text-muted)] text-center py-6">
                    No CFOP phase telemetry recorded for this solve.
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
              {solves.length} {solves.length === 1 ? 'solve' : 'solves'} recorded · {profileName}
            </div>
          </div>

          {solves.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-xl px-2.5 py-1.5">
                <ArrowUpDown className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="bg-transparent text-xs text-[var(--text)] focus:outline-hidden cursor-pointer"
                >
                  <option value="date-desc" className="bg-[var(--surface)] text-[var(--text)]">Date: Newest</option>
                  <option value="date-asc" className="bg-[var(--surface)] text-[var(--text)]">Date: Oldest</option>
                  <option value="time-asc" className="bg-[var(--surface)] text-[var(--text)]">Time: Fastest</option>
                  <option value="time-desc" className="bg-[var(--surface)] text-[var(--text)]">Time: Slowest</option>
                </select>
              </div>

              <button
                onClick={() => exportSolvesCSV(solves, profileName)}
                className="px-2.5 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)] transition-colors rounded-xl bg-[var(--surface)] border border-[var(--border)] cursor-pointer flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
              <button
                onClick={handleClearHistory}
                className="px-2.5 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--red)] transition-colors rounded-xl bg-[var(--surface)] border border-[var(--border)] cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            </div>
          )}
        </div>

        {/* Solves List */}
        <div className="flex-1 overflow-y-auto max-h-[380px] lg:max-h-[520px] bg-[var(--surface)] border border-[var(--border)] rounded-2xl divide-y divide-[var(--border)] mb-2">
          {sortedSolves.length === 0 ? (
            <div className="py-16 text-center text-xs text-[var(--text-muted)]">
              No solves recorded yet. Complete a timed solve to see history!
            </div>
          ) : (
            sortedSolves.map((solve) => {
              const effectiveTime = getEffectiveTimeMs(solve);
              const timeObj = formatTime(effectiveTime);
              const isSelected = selectedSolve?.id === solve.id;
              const isPB = solve.id === stats?.bestSolveId && !solve.dnf;
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
                  className={`flex items-center justify-between p-3.5 transition-colors cursor-pointer relative ${
                    isSelected && isDesktop
                      ? 'bg-[var(--surface-2)] ring-1 ring-[var(--green)]/30'
                      : 'hover:bg-[var(--surface-2)]'
                  } ${isPB ? 'border-l-3 border-l-[var(--purple)]' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-[var(--text-muted)] w-6">
                      #{solve.solveNumber}
                    </span>
                    <div>
                      {solve.dnf ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-bold text-[var(--red)] font-tabular">
                            DNF
                          </span>
                          <span className="text-xs text-[var(--text-muted)] font-mono">
                            ({formatTime(solve.totalTimeMs).full}s)
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-baseline gap-1">
                          <div className={`font-mono text-base font-medium font-tabular ${isPB ? 'text-[var(--purple)] font-semibold' : 'text-[var(--text)]'}`}>
                            {timeObj.seconds}.<span className="text-xs text-[var(--text-muted)]">{timeObj.millis}</span>
                          </div>
                          {solve.plusTwo && (
                            <span className="text-xs font-mono text-[var(--orange)] font-semibold">+2</span>
                          )}
                        </div>
                      )}
                      <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5 mt-0.5">
                        <span>{dateStr}</span>
                        {isPB && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-heading font-semibold bg-[var(--purple)]/15 text-[var(--purple)] border border-[var(--purple)]/30">
                            <Trophy className="w-2.5 h-2.5 fill-[var(--purple)]" />
                            <span>PB</span>
                          </span>
                        )}
                        {solve.cubeConnected && (
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] bg-[var(--surface-2)] text-[var(--green)] border border-[var(--border)]">
                            Smart Cube
                          </span>
                        )}
                        {solve.dnf && (
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] bg-[var(--red)]/15 text-[var(--red)] border border-[var(--red)]/30">
                            DNF
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
              <div className="flex items-center gap-2">
                <h2 className="font-heading font-semibold text-base">Solve Details</h2>
                {selectedSolve.id === stats?.bestSolveId && !selectedSolve.dnf && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-heading font-semibold bg-[var(--purple)]/15 text-[var(--purple)] border border-[var(--purple)]/30">
                    <Trophy className="w-2.5 h-2.5 fill-[var(--purple)]" />
                    <span>PB</span>
                  </span>
                )}
              </div>
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
              {selectedSolve.dnf ? (
                <div>
                  <div className="font-mono text-3xl font-bold font-tabular text-[var(--red)]">
                    DNF
                  </div>
                  <div className="text-xs font-mono text-[var(--text-muted)] mt-0.5">
                    ({formatTime(selectedSolve.totalTimeMs).full}s)
                  </div>
                </div>
              ) : (
                <div className="font-mono text-3xl font-semibold font-tabular">
                  {formatTime(getEffectiveTimeMs(selectedSolve)).full}s
                  {selectedSolve.plusTwo && (
                    <span className="text-base text-[var(--orange)] ml-1 font-normal">+2</span>
                  )}
                </div>
              )}
              <div className="flex items-center justify-center gap-1.5 mt-1.5 flex-wrap">
                {selectedSolve.id === stats?.bestSolveId && !selectedSolve.dnf && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--purple)]/15 text-[var(--purple)] border border-[var(--purple)]/30">
                    Personal Best
                  </span>
                )}

                {selectedSolve.dnf && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--red)]/15 text-[var(--red)] border border-[var(--red)]/30">
                    DNF
                  </span>
                )}
                {selectedSolve.plusTwo && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--orange)]/15 text-[var(--orange)] border border-[var(--orange)]/30">
                    +2 Penalty
                  </span>
                )}
                {selectedSolve.cubeConnected && (
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--surface)] text-[var(--green)] border border-[var(--border)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
                    <span>Smart Cube Solve</span>
                  </div>
                )}
              </div>

              {/* Penalty Toggle Buttons */}
              <div className="grid grid-cols-3 gap-1.5 mt-3 max-w-[220px] mx-auto">
                <button
                  onClick={() => handleSetPenalty(selectedSolve.id, 'none')}
                  className={`py-1 rounded-lg text-[11px] font-mono font-medium transition-colors cursor-pointer border ${
                    !selectedSolve.plusTwo && !selectedSolve.dnf
                      ? 'bg-[var(--white)] text-[var(--bg)] border-[var(--white)] font-semibold'
                      : 'bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] border-[var(--border)]'
                  }`}
                >
                  OK
                </button>
                <button
                  onClick={() => handleSetPenalty(selectedSolve.id, '+2')}
                  className={`py-1 rounded-lg text-[11px] font-mono font-medium transition-colors cursor-pointer border ${
                    selectedSolve.plusTwo
                      ? 'bg-[var(--orange)] text-white border-[var(--orange)] font-semibold'
                      : 'bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] border-[var(--border)]'
                  }`}
                >
                  +2
                </button>
                <button
                  onClick={() => handleSetPenalty(selectedSolve.id, 'dnf')}
                  className={`py-1 rounded-lg text-[11px] font-mono font-medium transition-colors cursor-pointer border ${
                    selectedSolve.dnf
                      ? 'bg-[var(--red)] text-white border-[var(--red)] font-semibold'
                      : 'bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] border-[var(--border)]'
                  }`}
                >
                  DNF
                </button>
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
                  totalTimeMs={getEffectiveTimeMs(selectedSolve)}
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

