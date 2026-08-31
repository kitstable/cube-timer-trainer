import React, { useEffect, useState, useMemo } from 'react';
import { Play, Square, RotateCcw } from 'lucide-react';
import { TwistyPlayerWrapper } from '../TwistyPlayerWrapper';
import { StopSolveModal } from '../StopSolveModal';
import { useTimer } from '../../hooks/useTimer';
import { useSolverWorker } from '../../hooks/useSolverWorker';
import { useCubeStore } from '../../store/useCubeStore';
import { useAppStore } from '../../store/useAppStore';
import { formatTime } from '../../utils/telemetryCalculator';
import { PhaseBreakdown } from '../ui/PhaseBreakdown';
import { LivePhaseSplits } from '../ui/LivePhaseSplits';
import { PHASE_DISPLAY_NAMES } from '../../utils/constants';
import { getSolvesByProfile, calculateSessionStats, type SessionStats } from '../../db/repository';
import { useIsDesktop } from '../../hooks/useMediaQuery';

export const TimedSolveView: React.FC = () => {
  const {
    timerState,
    elapsedMs,
    inspectionRemainingMs,
    lastCompletedSolve,
    startInspection,
    startSolve,
    pauseTimer,
    resumeTimer,
    saveDnfSolve,
    discardSolve,
    resetTimer,
    handleHoldStart,
    handleHoldRelease,
  } = useTimer();

  const { monotonicPhase: rawMonotonicPhase, smartCube, moveHistory, visualAlg, solveTracker, lastMoveTimestamp, setScramble: setCubeStoreScramble } = useCubeStore();
  // During a connected solve the dedicated CFOP tracker holds the correct live phase.
  const monotonicPhase = solveTracker.active ? solveTracker.monotonicPhase : rawMonotonicPhase;
  const { currentProfileId, currentScramble, setMode, setScramble } = useAppStore();
  const { generateScramble } = useSolverWorker();
  const isDesktop = useIsDesktop();
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [isPreparingScramble, setIsPreparingScramble] = useState(false);

  // Moves made during this solve
  const solveMovesAlg = useMemo(() => {
    return moveHistory.map((m) => m.move).join(' ');
  }, [moveHistory]);

  // While a smart cube is connected, `visualAlg` mirrors the cube's true live physical
  // state (reconstructed from its own reads, not from whatever scramble the app happens
  // to remember) — use it directly instead of composing setup+moveHistory, which breaks
  // as soon as the cube was connected mid-solve with no known scramble string on file.
  const usePhysicalVisual = smartCube.isConnected && visualAlg.length > 0;
  const setupAlg = usePhysicalVisual ? '' : (currentScramble || '');
  const displayAlg = usePhysicalVisual ? visualAlg : solveMovesAlg;
  const cubeHeight = isDesktop ? 380 : 215;

  // Load session stats
  const loadStats = async () => {
    try {
      const solves = await getSolvesByProfile(currentProfileId);
      const s = calculateSessionStats(solves);
      setStats(s);
    } catch (err) {
      console.warn('Failed to load session stats:', err);
    }
  };

  useEffect(() => {
    loadStats();
  }, [currentProfileId, lastCompletedSolve]);

  // Spacebar hotkey handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (timerState === 'paused') return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        handleHoldStart();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (timerState === 'paused') return;
      if (e.code === 'Space') {
        e.preventDefault();
        handleHoldRelease();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleHoldStart, handleHoldRelease, timerState]);

  const formattedSolveTime = formatTime(elapsedMs);
  const formattedInspection = (inspectionRemainingMs / 1000).toFixed(1);

  // "Next Scramble": generate a fresh WCA scramble, seed both stores, then jump to the
  // Scramble tab. Without regenerating here, ScrambleView mounts still holding the just-
  // solved scramble (already marked complete) and never produces a new one.
  const handleCompletedCta = async () => {
    setIsPreparingScramble(true);
    try {
      const res = await generateScramble();
      setScramble(res.scramble, res.moves);
      await setCubeStoreScramble(res.scramble);
      resetTimer();
      setMode('scramble');
    } catch (err) {
      console.error('Failed to generate next scramble:', err);
      resetTimer();
      setMode('scramble');
    } finally {
      setIsPreparingScramble(false);
    }
  };

  // Determine timer text color / status
  let phaseStatusLabel = 'Ready';
  let timerTextColor = 'text-[var(--text)]';

  if (timerState === 'holding') {
    phaseStatusLabel = 'Hold to arm…';
    timerTextColor = 'text-[var(--red)]';
  } else if (timerState === 'ready') {
    phaseStatusLabel = 'Release to start!';
    timerTextColor = 'text-[var(--green)]';
  } else if (timerState === 'inspection') {
    phaseStatusLabel = 'Inspection';
    timerTextColor = 'text-[var(--orange)]';
  } else if (timerState === 'running') {
    phaseStatusLabel = `solving — ${PHASE_DISPLAY_NAMES[monotonicPhase]?.toLowerCase() || monotonicPhase}`;
    timerTextColor = 'text-[var(--text)]';
  } else if (timerState === 'paused') {
    phaseStatusLabel = 'Solve paused';
    timerTextColor = 'text-[var(--orange)]';
  } else if (timerState === 'completed') {
    if (lastCompletedSolve?.dnf) {
      phaseStatusLabel = 'Solve DNF';
      timerTextColor = 'text-[var(--red)]';
    } else {
      phaseStatusLabel = 'Solve completed';
      timerTextColor = 'text-[var(--green)]';
    }
  }

  return (
    <div
      className="flex flex-col lg:grid lg:grid-cols-12 lg:gap-8 flex-1 pb-4 select-none"
      onMouseDown={(e) => {
        if (timerState === 'paused') return;
        if ((e.target as HTMLElement).closest('button, a, input, [role="button"], [role="dialog"]')) return;
        handleHoldStart();
      }}
      onMouseUp={(e) => {
        if (timerState === 'paused') return;
        if ((e.target as HTMLElement).closest('button, a, input, [role="button"], [role="dialog"]')) return;
        handleHoldRelease();
      }}
      onTouchStart={(e) => {
        if (timerState === 'paused') return;
        if ((e.target as HTMLElement).closest('button, a, input, [role="button"], [role="dialog"]')) return;
        handleHoldStart();
      }}
      onTouchEnd={(e) => {
        if (timerState === 'paused') return;
        if ((e.target as HTMLElement).closest('button, a, input, [role="button"], [role="dialog"]')) return;
        handleHoldRelease();
      }}
    >
      {/* Mobile Title Bar */}
      <div className="flex lg:hidden mb-2 items-center justify-between">
        <div>
          <h1 className="font-heading font-semibold text-xl tracking-tight text-[var(--text)]">
            Timed solve
          </h1>
          <div className="text-xs text-[var(--text-muted)]">
            {stats && stats.count > 0 ? (
              <span>
                Session Ao5: <strong className="text-[var(--text)] font-mono">{stats.ao5 ? (stats.ao5 / 1000).toFixed(2) + 's' : '—'}</strong> · {stats.count} solves
              </span>
            ) : (
              'Hold spacebar or touch screen to start'
            )}
          </div>
        </div>
      </div>

      {/* LEFT COLUMN: Large 3D Visualizer Stage */}
      <div className="lg:col-span-5 xl:col-span-5 flex flex-col justify-between mb-3 lg:mb-0">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 flex items-center justify-center min-h-[225px] lg:min-h-[440px] lg:flex-1 relative">
          <TwistyPlayerWrapper
            setupAlg={setupAlg}
            alg={displayAlg}
            tempoScale={3}
            height={cubeHeight}
          />
          {smartCube.isConnected && (
            <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-[var(--surface-2)]/90 border border-[var(--border)] text-xs font-mono text-[var(--green)] flex items-center gap-1.5 backdrop-blur-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />
              <span>Live Sync</span>
            </div>
          )}
        </div>

        {/* Desktop Session Stats Summary below cube */}
        {stats && stats.count > 0 && (
          <div className="hidden lg:grid grid-cols-3 gap-2 mt-3 p-3 bg-[var(--surface)] border border-[var(--border)] rounded-2xl text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-0.5">Ao5</div>
              <div className="font-mono text-sm font-semibold text-[var(--text)] font-tabular">
                {stats.ao5 ? `${(stats.ao5 / 1000).toFixed(2)}s` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-0.5">Best</div>
              <div className="font-mono text-sm font-semibold text-[var(--green)] font-tabular">
                {stats.best ? `${(stats.best / 1000).toFixed(2)}s` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-0.5">Solves</div>
              <div className="font-mono text-sm font-semibold text-[var(--text)] font-tabular">
                {stats.count}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: Digital Timer, Live Splits, Telemetry & CTA */}
      <div className="lg:col-span-7 xl:col-span-7 flex flex-col justify-between">
        {/* Desktop Header */}
        <div className="hidden lg:flex items-center justify-between mb-3 pb-2 border-b border-[var(--border)]/50">
          <div>
            <h1 className="font-heading font-semibold text-2xl tracking-tight text-[var(--text)]">
              Timed Solve
            </h1>
            <div className="text-xs text-[var(--text-muted)] mt-0.5">
              {stats && stats.count > 0
                ? `Session: ${stats.count} solves completed · Ao5: ${stats.ao5 ? (stats.ao5 / 1000).toFixed(2) + 's' : '—'}`
                : 'Speedcubing timer with live CFOP phase splits'}
            </div>
          </div>
        </div>

        {/* Main Timer Display */}
        <div className="text-center py-6 my-auto bg-[var(--surface)]/50 border border-[var(--border)]/60 rounded-2xl mb-3">
          <div
            className={`font-mono text-xs tracking-wider uppercase mb-2 font-medium transition-colors ${
              timerState === 'running'
                ? 'text-[var(--green)]'
                : timerState === 'inspection' || timerState === 'paused'
                ? 'text-[var(--orange)]'
                : 'text-[var(--text-muted)]'
            }`}
          >
            {phaseStatusLabel}
          </div>

          <div className={`font-mono text-5xl lg:text-7xl font-medium tracking-tight font-tabular transition-colors ${timerTextColor}`}>
            {timerState === 'inspection' ? (
              <span>{formattedInspection}</span>
            ) : lastCompletedSolve?.dnf && timerState === 'completed' ? (
              <div className="flex flex-col items-center">
                <span className="text-[var(--red)] font-bold text-5xl lg:text-7xl">DNF</span>
                <span className="text-sm lg:text-base text-[var(--text-muted)] font-mono mt-1 font-tabular">
                  ({formattedSolveTime.seconds}.{formattedSolveTime.millis}s)
                </span>
              </div>
            ) : (
              <>
                {formattedSolveTime.seconds}.
                <span className="text-2xl lg:text-4xl text-[var(--text-muted)]">
                  {formattedSolveTime.millis}
                </span>
              </>
            )}
          </div>

          {timerState === 'idle' && (
            <div className="text-xs text-[var(--text-muted)] mt-2 font-mono">
              {smartCube.isConnected ? 'Cube ready · Turn to start solve' : 'Hold Spacebar or touch screen to start'}
            </div>
          )}
        </div>

        {/* Phase Splits Panel */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-2 mb-3">
          {lastCompletedSolve && lastCompletedSolve.phases && lastCompletedSolve.phases.length > 0 ? (
            <div className="px-2 py-1">
              <PhaseBreakdown
                phases={lastCompletedSolve.phases}
                totalTimeMs={lastCompletedSolve.totalTimeMs}
                totalMoves={lastCompletedSolve.cubeConnected ? lastCompletedSolve.totalMoves : undefined}
                overallTps={lastCompletedSolve.cubeConnected ? lastCompletedSolve.overallTps : undefined}
              />
            </div>
          ) : timerState === 'running' && smartCube.isConnected ? (
            <LivePhaseSplits
              moves={solveTracker.active ? solveTracker.moveHistory : moveHistory}
              currentPhase={monotonicPhase}
              lastMoveTs={lastMoveTimestamp}
              running={timerState === 'running'}
            />
          ) : (
            <div className="py-5 px-3 text-center text-xs text-[var(--text-muted)] font-sans">
              {smartCube.isConnected
                ? 'Real-time CFOP splits will appear here during solve'
                : 'Two-phase inspection & solve timer'}
            </div>
          )}
        </div>

        {/* Bottom CTA Button */}
        <div className="mt-auto pt-2">
          {timerState === 'running' || timerState === 'paused' ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (timerState === 'running') {
                  pauseTimer();
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              className="w-full py-4 rounded-xl font-heading font-semibold text-[15px] bg-[var(--red)] text-white hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              <Square className="w-4 h-4 fill-current" />
              <span>Stop</span>
            </button>
          ) : timerState === 'completed' ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!isPreparingScramble) handleCompletedCta();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              disabled={isPreparingScramble}
              className="w-full py-3.5 rounded-xl font-heading font-semibold text-[15px] bg-[var(--white)] text-[var(--bg)] hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-60"
            >
              <RotateCcw className={`w-4 h-4 ${isPreparingScramble ? 'animate-spin' : ''}`} />
              <span>{isPreparingScramble ? 'Generating…' : 'Next Scramble'}</span>
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (timerState === 'idle') startInspection();
                else if (timerState === 'inspection') startSolve();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              className="w-full py-3.5 rounded-xl font-heading font-semibold text-[15px] bg-[var(--white)] text-[var(--bg)] hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{timerState === 'inspection' ? 'Start Solve' : 'Start Inspection'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Stop Solve / DNF Prompt Modal */}
      <StopSolveModal
        isOpen={timerState === 'paused'}
        onSaveDnf={saveDnfSolve}
        onDiscard={discardSolve}
        onCancel={resumeTimer}
      />
    </div>
  );
};
