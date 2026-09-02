import { useState, useEffect, useRef, useCallback } from 'react';
import { Alg } from 'cubing/alg';
import confetti from 'canvas-confetti';
import { useCubeStore } from '../store/useCubeStore';
import { useAppStore } from '../store/useAppStore';
import { saveSolve, updateSolve, deleteSolve } from '../db/repository';
import { calculateSolveTelemetry } from '../utils/telemetryCalculator';
import { getDefaultPattern } from '../utils/kpuzzleHelper';
import { readActiveSmartCubePattern } from './useSmartCube';
import type { Solve } from '../types/db';
import type { CFOPPhase } from '../types/cube';

export type TimerState = 'idle' | 'holding' | 'ready' | 'inspection' | 'running' | 'paused' | 'micro-solve' | 'completed';

export interface PendingMicroSolve {
  moves: any[];
  finalSolveTimeMs: number;
  inspectionDuration: number;
  isCubeConnected: boolean;
}

export function useTimer() {
  const [timerState, setTimerState] = useState<TimerState>('idle');
  const [requireManualStart, setRequireManualStart] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [inspectionRemainingMs, setInspectionRemainingMs] = useState(15000);
  const [lastCompletedSolve, setLastCompletedSolve] = useState<Solve | null>(null);
  const [pendingMicroSolve, setPendingMicroSolve] = useState<{ moveCount: number; timeMs: number } | null>(null);

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
  const pauseStartRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedMoveTsRef = useRef<number>(0);
  const pendingSolveDataRef = useRef<PendingMicroSolve | null>(null);

  const phaseTimingsRef = useRef<{ phase: CFOPPhase; start: number; end: number }[]>([]);
  const currentPhaseRef = useRef<CFOPPhase>('cross');

  const startInspection = useCallback(() => {
    setRequireManualStart(false);
    setTimerState('inspection');
    setInspectionRemainingMs(15000);
    inspectionStartRef.current = performance.now();
  }, []);


  const startSolve = useCallback((opts?: { preserveTracking?: boolean }) => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const now = performance.now();
    startTimestampRef.current = now;
    pauseStartRef.current = 0;
    pendingSolveDataRef.current = null;
    setPendingMicroSolve(null);
    currentPhaseRef.current = 'cross';
    phaseTimingsRef.current = [{ phase: 'cross', start: now, end: now }];

    // On the smart-cube auto-start path the triggering turn is already in `moveHistory`
    // (and tracking was reset when Timed mode was entered) — clearing here would drop the
    // first move from the count. Manual / no-cube starts still reset.
    if (!opts?.preserveTracking) {
      resetSolveTracking();
      setRequireManualStart(false);
    }
    setElapsedMs(0);
    setTimerState('running');
  }, [resetSolveTracking]);

  const pauseTimer = useCallback(() => {
    if (timerState !== 'running') return;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    const now = performance.now();
    pauseStartRef.current = now;
    const currentElapsed = Math.round(now - startTimestampRef.current);
    setElapsedMs(currentElapsed);
    setTimerState('paused');
  }, [timerState]);

  const resumeTimer = useCallback(() => {
    if (timerState !== 'paused') return;

    const now = performance.now();
    const pausedDuration = pauseStartRef.current > 0 ? now - pauseStartRef.current : 0;
    startTimestampRef.current += pausedDuration;
    pauseStartRef.current = 0;
    setTimerState('running');
  }, [timerState]);

  const saveDnfSolve = useCallback(async () => {
    if (timerState !== 'paused' && timerState !== 'running') return;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    const finalSolveTimeMs = elapsedMs;
    setRequireManualStart(true);
    setTimerState('completed');

    const inspectionDuration =
      inspectionStartRef.current > 0 ? Math.round(startTimestampRef.current - inspectionStartRef.current) : 0;

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
        dnf: true,
      });

      setLastCompletedSolve(record);
    } catch (err) {
      console.error('Failed to save DNF solve record:', err);
    }
  }, [timerState, elapsedMs, smartCube.isConnected, currentProfileId, scrambleMoves, endSolveTracking]);

  const discardSolve = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    endSolveTracking();
    resetSolveTracking();
    setRequireManualStart(true);
    setTimerState('idle');
    setElapsedMs(0);
    setInspectionRemainingMs(15000);
    inspectionStartRef.current = 0;
    pauseStartRef.current = 0;
    pendingSolveDataRef.current = null;
    setPendingMicroSolve(null);
  }, [endSolveTracking, resetSolveTracking]);

  const commitSolveRecord = useCallback(async (
    finalSolveTimeMs: number,
    inspectionDuration: number,
    moves: any[],
    isCubeConnected: boolean
  ) => {
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
        colors: ['#F3F1EA', '#009A44', '#0057B8', '#FFD500', '#A855F7', '#C8102E'],
      });

    } catch (err) {
      console.error('Failed to save solve record:', err);
    }
  }, [currentProfileId, scrambleMoves, endSolveTracking]);

  const stopTimer = useCallback(async (opts?: { force?: boolean }) => {
    if (timerState !== 'running' && timerState !== 'paused') return;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const endNow = performance.now();
    const finalSolveTimeMs = timerState === 'paused' ? elapsedMs : Math.round(endNow - startTimestampRef.current);
    setElapsedMs(finalSolveTimeMs);

    const inspectionDuration = inspectionStartRef.current > 0 ? Math.round(startTimestampRef.current - inspectionStartRef.current) : 0;

    const tracker = useCubeStore.getState().solveTracker;
    const moves =
      tracker.active && tracker.moveHistory.length > 0
        ? tracker.moveHistory
        : useCubeStore.getState().moveHistory;
    const isCubeConnected = smartCube.isConnected;

    // Check for accidental micro-solves (< 3 moves on smart cube, or < 1000ms)
    const isMicroSolve = !opts?.force && (
      (isCubeConnected && moves.length < 3) ||
      (!isCubeConnected && finalSolveTimeMs < 1000) ||
      finalSolveTimeMs < 800
    );

    if (isMicroSolve) {
      pendingSolveDataRef.current = {
        moves,
        finalSolveTimeMs,
        inspectionDuration,
        isCubeConnected,
      };
      setPendingMicroSolve({
        moveCount: moves.length,
        timeMs: finalSolveTimeMs,
      });
      setTimerState('micro-solve');
      return;
    }

    setRequireManualStart(true);
    setTimerState('completed');
    await commitSolveRecord(finalSolveTimeMs, inspectionDuration, moves, isCubeConnected);
  }, [timerState, elapsedMs, smartCube.isConnected, commitSolveRecord]);

  const confirmSaveMicroSolve = useCallback(async () => {
    if (!pendingSolveDataRef.current) return;
    const { finalSolveTimeMs, inspectionDuration, moves, isCubeConnected } = pendingSolveDataRef.current;
    setPendingMicroSolve(null);
    pendingSolveDataRef.current = null;
    setRequireManualStart(true);
    setTimerState('completed');
    await commitSolveRecord(finalSolveTimeMs, inspectionDuration, moves, isCubeConnected);
  }, [commitSolveRecord]);

  const discardMicroSolve = useCallback(() => {
    discardSolve();
  }, [discardSolve]);

  const togglePlusTwo = useCallback(async () => {
    if (!lastCompletedSolve) return;
    const newPlusTwo = !lastCompletedSolve.plusTwo;
    try {
      await updateSolve(lastCompletedSolve.id, { plusTwo: newPlusTwo });
      setLastCompletedSolve((prev) => prev ? { ...prev, plusTwo: newPlusTwo } : null);
    } catch (err) {
      console.error('Failed to toggle +2 penalty:', err);
    }
  }, [lastCompletedSolve]);

  const toggleDnf = useCallback(async () => {
    if (!lastCompletedSolve) return;
    const newDnf = !lastCompletedSolve.dnf;
    try {
      await updateSolve(lastCompletedSolve.id, { dnf: newDnf });
      setLastCompletedSolve((prev) => prev ? { ...prev, dnf: newDnf } : null);
    } catch (err) {
      console.error('Failed to toggle DNF:', err);
    }
  }, [lastCompletedSolve]);

  const resetTimer = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setTimerState('idle');
    setElapsedMs(0);
    setInspectionRemainingMs(15000);
    inspectionStartRef.current = 0;
    pauseStartRef.current = 0;
    pendingSolveDataRef.current = null;
    setPendingMicroSolve(null);
  }, []);

  const deleteLastSolve = useCallback(async () => {
    if (!lastCompletedSolve) return;
    try {
      await deleteSolve(lastCompletedSolve.id);
      setLastCompletedSolve(null);
      resetTimer();
    } catch (err) {
      console.error('Failed to delete solve:', err);
    }
  }, [lastCompletedSolve, resetTimer]);


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

    setRequireManualStart(false);
    lastProcessedMoveTsRef.current = useCubeStore.getState().lastMoveTimestamp || 0;
    inspectionStartRef.current = 0;
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

    if (timerState === 'inspection') {
      startSolve({ preserveTracking: true });
    } else if (timerState === 'idle' && !requireManualStart) {
      startSolve({ preserveTracking: true });
    }
  }, [activeMode, smartCube.isConnected, lastMoveTimestamp, lastMove, timerState, requireManualStart, startSolve]);

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

  // Handle completion when smart cube becomes solved in running state. Prefer the dedicated
  // solve tracker (correct CFOP frame) when it's active; otherwise fall back to the raw
  // store status. Manual solves (no smart cube) must NOT auto-stop here since the physical
  // cube's state is unknown.
  const solvedNow = solveTracker.active
    ? solveTracker.status.isFullySolved
    : phaseStatus.isFullySolved;
  useEffect(() => {
    if (smartCube.isConnected && timerState === 'running' && solvedNow) {
      stopTimer();
    }
  }, [smartCube.isConnected, timerState, solvedNow, stopTimer]);


  const updateRunningTime = useCallback(() => {
    if (timerState === 'running') {
      const now = performance.now();
      const current = Math.max(0, now - startTimestampRef.current);
      setElapsedMs(current);
      animFrameRef.current = requestAnimationFrame(updateRunningTime);
    } else if (timerState === 'inspection') {
      const now = performance.now();
      if (inspectionStartRef.current === 0) {
        inspectionStartRef.current = now;
      }
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
    if (timerState === 'paused' || timerState === 'micro-solve') {
      return;
    }

    if (timerState === 'running') {
      if (smartCube.isConnected) {
        pauseTimer();
      } else {
        stopTimer();
      }
      return;
    }

    if (timerState === 'completed') {
      resetTimer();
      return;
    }

    if (timerState === 'idle') {
      setRequireManualStart(false);
      startInspection();
      return;
    }

    if (timerState === 'inspection') {
      setRequireManualStart(false);
      setTimerState('holding');
      holdTimeoutRef.current = setTimeout(() => {
        setTimerState('ready');
      }, 300); // 300ms hold to turn green/ready
    }
  }, [timerState, smartCube.isConnected, pauseTimer, stopTimer, resetTimer, startInspection]);

  const handleHoldRelease = useCallback(() => {
    if (timerState === 'paused' || timerState === 'micro-solve') {
      return;
    }

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
    requireManualStart,
    elapsedMs,
    inspectionRemainingMs,
    lastCompletedSolve,
    pendingMicroSolve,
    startInspection,
    startSolve,
    stopTimer,
    pauseTimer,
    resumeTimer,
    saveDnfSolve,
    discardSolve,
    confirmSaveMicroSolve,
    discardMicroSolve,
    togglePlusTwo,
    toggleDnf,
    deleteLastSolve,
    resetTimer,
    handleHoldStart,
    handleHoldRelease,
  };
}

