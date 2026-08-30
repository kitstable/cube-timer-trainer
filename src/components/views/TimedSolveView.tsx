import React, { useEffect, useState, useMemo } from 'react';
import { Play, Square, RotateCcw } from 'lucide-react';
import { TwistyPlayerWrapper } from '../TwistyPlayerWrapper';
import { useTimer } from '../../hooks/useTimer';
import { useCubeStore } from '../../store/useCubeStore';
import { useAppStore } from '../../store/useAppStore';
import { formatTime } from '../../utils/telemetryCalculator';
import { PhaseBreakdown } from '../ui/PhaseBreakdown';
import { LivePhaseSplits } from '../ui/LivePhaseSplits';
import { PHASE_DISPLAY_NAMES } from '../../utils/constants';
import { getSolvesByProfile, calculateSessionStats, type SessionStats } from '../../db/repository';

export const TimedSolveView: React.FC = () => {
  const {
    timerState,
    elapsedMs,
    inspectionRemainingMs,
    lastCompletedSolve,
    startInspection,
    startSolve,
    stopTimer,
    resetTimer,
    handleHoldStart,
    handleHoldRelease,
  } = useTimer();

  const { monotonicPhase: rawMonotonicPhase, smartCube, moveHistory, phaseStatus, visualAlg, solveTracker, lastMoveTimestamp } = useCubeStore();
  // During a connected solve the dedicated CFOP tracker holds the correct live phase.
  const monotonicPhase = solveTracker.active ? solveTracker.monotonicPhase : rawMonotonicPhase;
  const { currentProfileId, currentScramble, setMode } = useAppStore();
  const [stats, setStats] = useState<SessionStats | null>(null);

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
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        handleHoldStart();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
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
  }, [handleHoldStart, handleHoldRelease]);

  const formattedSolveTime = formatTime(elapsedMs);
  const formattedInspection = (inspectionRemainingMs / 1000).toFixed(1);

  // After a completed solve, jump back to Scramble for a fresh scramble when the cube is
  // (or was tracked as) solved — a connected solve that finished, or a solved raw pattern.
  const backToScramble =
    timerState === 'completed' &&
    (Boolean(lastCompletedSolve?.cubeConnected) || phaseStatus.isFullySolved);

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
  } else if (timerState === 'completed') {
    phaseStatusLabel = 'Solve completed';
    timerTextColor = 'text-[var(--green)]';
  }

  return (
    <div
      className="flex flex-col flex-1 pb-4 select-none"
      onMouseDown={handleHoldStart}
      onMouseUp={handleHoldRelease}
      onTouchStart={handleHoldStart}
      onTouchEnd={handleHoldRelease}
    >
      <div className="mb-2">
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

      {/* 3D Cube Visualizer Card */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-2 mb-2 flex items-center justify-center min-h-[225px] relative">
        <TwistyPlayerWrapper
          setupAlg={setupAlg}
          alg={displayAlg}
          tempoScale={3}
          height={215}
        />
        {smartCube.isConnected && (
          <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-[var(--surface-2)]/90 border border-[var(--border)] text-[10px] font-mono text-[var(--green)] flex items-center gap-1.5 backdrop-blur-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />
            <span>Live Sync</span>
          </div>
        )}
      </div>

      {/* Main Timer Display */}
      <div className="text-center py-4 my-auto">
        <div
          className={`font-mono text-xs tracking-wider uppercase mb-1.5 font-medium transition-colors ${
            timerState === 'running'
              ? 'text-[var(--green)]'
              : timerState === 'inspection'
              ? 'text-[var(--orange)]'
              : 'text-[var(--text-muted)]'
          }`}
        >
          {phaseStatusLabel}
        </div>

        <div className={`font-mono text-5xl font-medium tracking-tight font-tabular transition-colors ${timerTextColor}`}>
          {timerState === 'inspection' ? (
            <span>{formattedInspection}</span>
          ) : (
            <>
              {formattedSolveTime.seconds}.
              <span className="text-2xl text-[var(--text-muted)]">
                {formattedSolveTime.millis}
              </span>
            </>
          )}
        </div>

        {timerState === 'idle' && (
          <div className="text-xs text-[var(--text-muted)] mt-1.5 font-mono">
            {smartCube.isConnected ? 'Cube ready · Turn to start solve' : 'Touch & hold or press Space'}
          </div>
        )}
      </div>

      {/* Phase Splits Panel */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-1 mb-4">
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
          <div className="py-4 px-3 text-center text-xs text-[var(--text-muted)] font-sans">
            {smartCube.isConnected
              ? 'Real-time CFOP splits will appear here during solve'
              : 'Two-phase inspection & solve timer'}
          </div>
        )}
      </div>

      {/* Bottom CTA Button */}
      <div className="mt-auto pt-2">
        {timerState === 'running' ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              stopTimer();
            }}
            className="w-full py-4 rounded-xl font-heading font-semibold text-[15px] bg-[var(--red)] text-white hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
          >
            <Square className="w-4 h-4 fill-current" />
            <span>Stop</span>
          </button>
        ) : timerState === 'completed' ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              resetTimer();
              if (backToScramble) {
                setMode('scramble');
              }
            }}
            className="w-full py-3.5 rounded-xl font-heading font-semibold text-[15px] bg-[var(--white)] text-[var(--bg)] hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
          >
            <RotateCcw className="w-4 h-4" />
            <span>{backToScramble ? 'Next Scramble' : 'New Solve'}</span>
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (timerState === 'idle') startInspection();
              else if (timerState === 'inspection') startSolve();
            }}
            className="w-full py-3.5 rounded-xl font-heading font-semibold text-[15px] bg-[var(--white)] text-[var(--bg)] hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>{timerState === 'inspection' ? 'Start Solve' : 'Start Inspection'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
