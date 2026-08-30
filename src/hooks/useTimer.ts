import { useState, useEffect, useRef, useCallback } from 'react';
import { Alg } from 'cubing/alg';
import confetti from 'canvas-confetti';
import { useCubeStore } from '../store/useCubeStore';
import { useAppStore } from '../store/useAppStore';
import { saveSolve } from '../db/repository';
import { calculateSolveTelemetry } from '../utils/telemetryCalculator';
import { getDefaultPattern } from '../utils/kpuzzleHelper';
import { readActiveSmartCubePattern } from './useSmartCube';
import type { Solve } from '../types/db';
import type { CFOPPhase } from '../types/cube';

export type TimerState = 'idle' | 'holding' | 'ready' | 'inspection' | 'running' | 'completed';

export function useTimer() {
  const [timerState, setTimerState] = useState<TimerState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [inspectionRemainingMs, setInspectionRemainingMs] = useState(15000);
  const [lastCompletedSolve, setLastCompletedSolve] = useState<Solve | null>(null);

  const {
    phaseStatus,
    monotonicPhase,
    smartCube,
    lastMove,
    lastMoveTimestamp,
    resetSolveTracking,
    solveTracker,
    beginSolveTracking,
    endSolveTracking,
  } = useCubeStore();
  const { currentProfileId, scrambleMoves, activeMode, currentScramble } = useAppStore();

  const startTimestampRef = useRef<number>(0);
  const inspectionStartRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedMoveTsRef = useRef<number>(0);

  const phaseTimingsRef = useRef<{ phase: CFOPPhase; start: number; end: number }[]>([]);
  const currentPhaseRef = useRef<CFOPPhase>('cross');

  const startInspection = useCallback(() => {
    setTimerState('inspection');
    setInspectionRemainingMs(15000);
    // Don't clobber an inspection clock already started on entering Timed mode (connected
    // flow) — an incidental screen touch must not reset how long you've been inspecting.
    if (inspectionStartRef.current === 0) inspectionStartRef.current = performance.now();
  }, []);

  const startSolve = useCallback((opts?: { preserveTracking?: boolean }) => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const now = performance.now();
    startTimestampRef.current = now;
    currentPhaseRef.current = 'cross';
    phaseTimingsRef.current = [{ phase: 'cross', start: now, end: now }];

    // On the smart-cube auto-start path the triggering turn is already in `moveHistory`
    // (and tracking was reset when Timed mode was entered) — clearing here would drop the
    // first move from the count. Manual / no-cube starts still reset.
    if (!opts?.preserveTracking) resetSolveTracking();
    setElapsedMs(0);
    setTimerState('running');
  }, [resetSolveTracking]);

  const stopTimer = useCallback(async () => {
    if (timerState !== 'running') return;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const endNow = performance.now();
    const finalSolveTimeMs = Math.round(endNow - startTimestampRef.current);
    setElapsedMs(finalSolveTimeMs);
    setTimerState('completed');

    const inspectionDuration = inspectionStartRef.current > 0 ? Math.round(startTimestampRef.current - inspectionStartRef.current) : 0;

    // Prefer the dedicated CFOP tracker's move history (correct phase labels); fall back
    // to the raw store history for cubes/protocols where tracking couldn't be seeded.
    const tracker = useCubeStore.getState().solveTracker;
    const moves =
      tracker.active && tracker.moveHistory.length > 0
        ? tracker.moveHistory
        : useCubeStore.getState().moveHistory;
    const isCubeConnected = smartCube.isConnected;
    endSolveTracking();

    const telemetry = calculateSolveTelemetry(
      inspectionDuration,
      moves,
      finalSolveTimeMs,
      isCubeConnected
    );

    try {
      const record = await saveSolve({
        profileId: currentProfileId,
        scrambleMoves,
        mode: 'timed',
        cubeConnected: isCubeConnected,
        phases: telemetry.phases,
        totalTimeMs: finalSolveTimeMs,
        totalMoves: telemetry.totalMoves,
        overallTps: telemetry.overallTps,
      });

      setLastCompletedSolve(record);

      // Trigger celebratory confetti
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#F3F1EA', '#009A44', '#0057B8', '#FFD500', '#E8A200', '#C8102E'],
      });
    } catch (err) {
      console.error('Failed to save solve record:', err);
    }
  }, [timerState, smartCube.isConnected, currentProfileId, scrambleMoves, endSolveTracking]);

  const resetTimer = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setTimerState('idle');
    setElapsedMs(0);
    setInspectionRemainingMs(15000);
    inspectionStartRef.current = 0;
  }, []);

  // Entering Timed mode with a connected cube: ignore any turns made before now (e.g.
  // finishing a scramble) so the timer doesn't auto-start on stale moves, start the
  // inspection clock, clear solve tracking so the first real turn is counted, and seed
  // the CFOP phase tracker from the clean scramble state (see SolveTrackerState).
  useEffect(() => {
    if (activeMode !== 'timed' || !smartCube.isConnected) {
      endSolveTracking();
      inspectionStartRef.current = 0;
      return;
    }
    if (timerState !== 'idle') return;

    lastProcessedMoveTsRef.current = useCubeStore.getState().lastMoveTimestamp || 0;
    if (inspectionStartRef.current === 0) inspectionStartRef.current = performance.now();
    resetSolveTracking();

    // Seed the CFOP phase tracker from the clean `default · scramble · z2` frame (the raw
    // store `pattern` isn't usable here — during a guided scramble it accumulates the
    // physical scramble turns on top of the z2 target).
    let cancelled = false;
    endSolveTracking();
    // Synchronous, race-free seed for the guided-scramble flow (always has currentScramble).
    if (currentScramble) {
      try {
        beginSolveTracking(getDefaultPattern().applyAlg(new Alg(`${currentScramble} z2`)));
      } catch (err) {
        console.warn('Failed to seed solve phase tracker from scramble:', err);
      }
    }
    // Upgrade to / cover with the cube's real current state if the read lands before the
    // first turn (handles a stale currentScramble, or a mid-solve connect with none).
    const tsAtSeed = useCubeStore.getState().lastMoveTimestamp;
    readActiveSmartCubePattern().then((raw) => {
      if (cancelled || !raw) return;
      if (useCubeStore.getState().lastMoveTimestamp !== tsAtSeed) return;
      try {
        beginSolveTracking(raw.applyAlg(new Alg('z2')));
      } catch {
        /* keep whatever seed we have (or none -> raw phaseStatus fallback) */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeMode, smartCube.isConnected, timerState, currentScramble, resetSolveTracking, beginSolveTracking, endSolveTracking]);

  // Auto-start solve on physical turn when smart cube is connected and timer is idle / inspecting
  useEffect(() => {
    if (activeMode !== 'timed' || !smartCube.isConnected || !lastMoveTimestamp || !lastMove) return;
    if (lastMoveTimestamp <= lastProcessedMoveTsRef.current) return;
    lastProcessedMoveTsRef.current = lastMoveTimestamp;

    if (timerState === 'idle' || timerState === 'inspection') {
      startSolve({ preserveTracking: true });
    }
  }, [activeMode, smartCube.isConnected, lastMoveTimestamp, lastMove, timerState, startSolve]);

  // Sync current phase during solve
  useEffect(() => {
    if (timerState !== 'running') return;

    if (monotonicPhase !== currentPhaseRef.current) {
      const now = performance.now();
      const prevPhase = currentPhaseRef.current;

      // Close previous phase
      const existing = phaseTimingsRef.current.find((p) => p.phase === prevPhase);
      if (existing) {
        existing.end = now;
      } else {
        phaseTimingsRef.current.push({ phase: prevPhase, start: startTimestampRef.current, end: now });
      }

      // Open new phase
      phaseTimingsRef.current.push({ phase: monotonicPhase, start: now, end: now });
      currentPhaseRef.current = monotonicPhase;
    }
  }, [monotonicPhase, timerState]);

  // Handle completion when cube becomes solved in running state. Prefer the dedicated
  // solve tracker (correct CFOP frame) when it's active; otherwise fall back to the raw
  // store status (manual / non-connected solves).
  const solvedNow = solveTracker.active
    ? solveTracker.status.isFullySolved
    : phaseStatus.isFullySolved;
  useEffect(() => {
    if (timerState === 'running' && solvedNow) {
      stopTimer();
    }
  }, [timerState, solvedNow, stopTimer]);


  const updateRunningTime = useCallback(() => {
    if (timerState === 'running') {
      const now = performance.now();
      const current = Math.max(0, now - startTimestampRef.current);
      setElapsedMs(current);
      animFrameRef.current = requestAnimationFrame(updateRunningTime);
    } else if (timerState === 'inspection') {
      const now = performance.now();
      const spent = now - inspectionStartRef.current;
      const remaining = Math.max(0, 15000 - spent);
      setInspectionRemainingMs(remaining);

      if (remaining === 0) {
        // Auto start solve if inspection runs out
        startSolve();
      } else {
        animFrameRef.current = requestAnimationFrame(updateRunningTime);
      }
    }
  }, [timerState, startSolve]);

  useEffect(() => {
    if (timerState === 'running' || timerState === 'inspection') {
      animFrameRef.current = requestAnimationFrame(updateRunningTime);
    }
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [timerState, updateRunningTime]);

  // Handle Spacebar & Touch Hold-to-Start interactions
  const handleHoldStart = useCallback(() => {
    if (timerState === 'running') {
      stopTimer();
      return;
    }

    if (timerState === 'completed') {
      resetTimer();
      return;
    }

    if (timerState === 'idle') {
      startInspection();
      return;
    }

    if (timerState === 'inspection') {
      setTimerState('holding');
      holdTimeoutRef.current = setTimeout(() => {
        setTimerState('ready');
      }, 300); // 300ms hold to turn green/ready
    }
  }, [timerState, stopTimer, resetTimer, startInspection]);

  const handleHoldRelease = useCallback(() => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }

    if (timerState === 'ready') {
      startSolve();
    } else if (timerState === 'holding') {
      setTimerState('inspection');
    }
  }, [timerState, startSolve]);

  return {
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
  };
}
