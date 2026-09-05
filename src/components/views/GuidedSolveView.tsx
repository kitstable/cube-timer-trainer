import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Alg } from 'cubing/alg';
import { RefreshCw, ArrowRight, RotateCw, ChevronLeft, ChevronRight, CheckCircle2, RotateCcw } from 'lucide-react';
import { TwistyPlayerWrapper } from '../TwistyPlayerWrapper';
import { PhaseRail } from '../ui/PhaseRail';
import { useCubeStore } from '../../store/useCubeStore';
import { useAppStore } from '../../store/useAppStore';
import { useSolverWorker } from '../../hooks/useSolverWorker';
import { evaluateCFOPFromPattern } from '../../utils/phaseDetector';
import { toZ2DisplayAlg, isAllFaceTurns, guidedPlanMoves } from '../../utils/kpuzzleHelper';
import {
  trackFeedbackPanelClass,
  trackFeedbackBadgeClass,
  trackFeedbackChipClass,
  TrackFeedbackMessage,
} from '../ui/TrackFeedback';
import { saveSolve } from '../../db/repository';
import { PHASE_DISPLAY_NAMES, ALL_F2L_SLOTS, getMoveDescription } from '../../utils/constants';
import type { CFOPPhase, F2LSlotId, MoveHint, TechniqueTier, NotationMode } from '../../types/cube';
import { useIsDesktop } from '../../hooks/useMediaQuery';

/**
 * Guided Solve — a CFOP teaching walkthrough.
 *
 * With a smart cube connected the hint is computed from the *live* physical `KPattern`
 * (`physicalPattern · z2`) — no fabricated scramble, no independent state. It then walks you
 * through that hint one move at a time, via the same shared move-sequence tracker
 * (`useAppStore`'s `trackTargetMoves`/`trackDoneMoves`/`trackRemainingMoves`/`trackFeedback`,
 * fed by `useSmartCube.ts`'s BLE listener + partial gate) that the Scramble guide and Training
 * reps use — so half-turns, commuting moves, and wrong-turn corrections are all handled
 * identically across the three surfaces instead of drifting apart. Reaching the end of a plan
 * (`trackRemainingMoves` empty) recomputes a fresh hint from the real state — so the guide is
 * always correct without fragile "undo the mistake" logic, but it doesn't churn a new alg on
 * every single turn.
 *
 * Without a cube it's the manual practice path: seed from the Scramble-tab scramble (or make
 * one), and step through the hint with the Next-move button / ribbon (virtual `applyMove`).
 * That path is untouched by the shared tracker — it uses its own `currentHint`/`hintMoveIndex`.
 */
export const GuidedSolveView: React.FC = () => {
  const {
    pattern,
    moveHistory,
    visualAlg,
    smartCube,
    applyMove,
    undoLastMove,
    undoMoves,
    setScramble: setCubeStoreScramble,
  } = useCubeStore();
  const physicalPattern = useCubeStore((s) => s.physicalPattern);
  const {
    currentScramble,
    currentProfileId,
    setScramble: setAppScramble,
    setMode,
    techniqueTier,
    setTechniqueTier,
    notationMode,
    setNotationMode,
    connectedYellowUp,
    trackTargetMoves,
    trackDoneMoves,
    trackRemainingMoves,
    trackFeedback: feedback,
    setTrackTarget,
    setGuidedRecomputing,
  } = useAppStore();
  const { findHint, generateScramble, isReady } = useSolverWorker();
  const isDesktop = useIsDesktop();

  const connected = smartCube.isConnected;

  const [currentHint, setCurrentHint] = useState<MoveHint | null>(null);
  const [hintMoveIndex, setHintMoveIndex] = useState<number>(0);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  // Phase / slots derived from the pattern the hint was computed against (the live physical
  // cube when connected — `useCubeStore.monotonicPhase` is the wrong frame there).
  const [livePhase, setLivePhase] = useState<CFOPPhase>('cross');
  const [liveSolvedSlots, setLiveSolvedSlots] = useState<F2LSlotId[]>([]);

  // Connected-solve timing (for saving a `mode: 'guided'` Solve on completion).
  const solveStartRef = useRef<{ ts: number; moveCount: number } | null>(null);
  const solveSavedRef = useRef<boolean>(false);

  // Connected: live progress through the current hint, read from the shared tracker
  // (`trackDoneMoves`/`trackRemainingMoves`/`feedback` above). `fetchInFlightRef` guards
  // against re-entrant "plan complete -> fetch a new one" calls.
  const planDone = trackDoneMoves;
  const planRemaining = trackRemainingMoves;
  const fetchInFlightRef = useRef<boolean>(false);

  /** The pattern the hint engine should read, always in the app's post-z2 frame. */
  const getHintPattern = useCallback(() => {
    const st = useCubeStore.getState();
    if (st.smartCube.isConnected) {
      return st.physicalPattern ? st.physicalPattern.applyAlg(new Alg('z2')) : null;
    }
    return st.pattern;
  }, []);

  const fetchHintForCurrentPhase = useCallback(
    async (tierOverride?: TechniqueTier, notationOverride?: NotationMode, deliberate = false) => {
      const hintPattern = getHintPattern();
      if (!hintPattern || !isReady) return;

      const status = evaluateCFOPFromPattern(hintPattern);
      const phase = status.currentPhase;
      setLivePhase(phase);
      setLiveSolvedSlots(status.solvedSlots);

      const activeTier = tierOverride || techniqueTier;
      const activeNotation = notationOverride || notationMode;
      setIsCalculating(true);
      // Pauses the shared BLE listener's Guided-mode feed while this is true (see
      // `useSmartCube.ts`) — a turn made mid-recompute must not be classified against the
      // about-to-be-replaced `trackTargetMoves`. Mirrors the old local `recomputingRef` guard.
      setGuidedRecomputing(true);
      try {
        const nextUnsolvedSlot = ALL_F2L_SLOTS.find((s) => !status.solvedSlots.includes(s));
        const res = await findHint(
          phase,
          hintPattern.patternData,
          nextUnsolvedSlot,
          activeTier,
          activeNotation,
          deliberate
        );
        if (res) {
          const hintPhase = (res.phase || phase) as CFOPPhase;
          const moves = res.moves || [];
          setCurrentHint({
            phase: hintPhase,
            phaseName: (PHASE_DISPLAY_NAMES as Record<string, string>)[hintPhase] || hintPhase,
            moves,
            currentIndex: 0,
            caseName: res.caseName || 'Guidance',
            rawAlg: moves.join(' '),
          });
          setHintMoveIndex(0);
          // Seed live walkthrough tracking against this hint via the shared tracker (the same
          // one Scramble/Training use — see `useAppStore.setTrackTarget`). `findHint` returns
          // moves in the post-z2 frame. Default (white-up 3D view): relabel them into the raw
          // smart-cube frame so the written algorithm matches a white-up cube and lines up with
          // raw `moveHistory` turns. Yellow-up view (`connectedYellowUp`): keep them post-z2 —
          // the shared BLE listener relabels incoming physical turns to match (see
          // `useSmartCube.ts`) — so the algorithm reads for a yellow-up cube, consistent with
          // the flipped 3D view. This computation must stay exactly as-is: the target frame and
          // the incoming-move frame have to agree, or turns silently misclassify.
          const planMoves = guidedPlanMoves(moves, useAppStore.getState().connectedYellowUp);
          if (connected) setTrackTarget(planMoves);
        }
      } catch (err) {
        console.warn('Failed to calculate guidance hint:', err);
      } finally {
        setIsCalculating(false);
        setGuidedRecomputing(false);
      }
    },
    [getHintPattern, isReady, findHint, techniqueTier, notationMode, connected, setTrackTarget, setGuidedRecomputing]
  );

  // Init on mount / connection change.
  useEffect(() => {
    const st = useCubeStore.getState();
    if (st.smartCube.isConnected) {
      // Connected: never fabricate a scramble — the hint reads the live cube. A stale
      // "assumed solved" first read is resolved by the header resync button.
      if (isReady) fetchHintForCurrentPhase();
      return;
    }
    // No cube — the manual practice path.
    if (currentScramble) {
      if (
        !st.pattern ||
        (st.moveHistory.length === 0 && (st.monotonicPhase === 'solved' || st.scramblePattern === null))
      ) {
        void setCubeStoreScramble(currentScramble);
      }
    } else if (isReady) {
      generateScramble()
        .then((res) => {
          setAppScramble(res.scramble, res.moves);
          return setCubeStoreScramble(res.scramble);
        })
        .catch((err) => console.warn('Failed to auto-generate scramble for guided solve:', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, currentScramble, isReady]);

  // Initial hint fetch once the solver + a pattern are ready (no-cube path).
  useEffect(() => {
    if (isReady && !connected && pattern && !currentHint) fetchHintForCurrentPhase();
  }, [isReady, connected, pattern, currentHint, fetchHintForCurrentPhase]);

  // Connected: the shared tracker (`useSmartCube.ts`'s BLE listener + partial gate,
  // `useAppStore.applyPhysicalTrackMove`) already classifies every physical turn against
  // `trackTargetMoves` — a match ticks a move off, a wrong/half turn raises `trackFeedback`
  // and prepends correction move(s), a rotation is a no-op. All this component needs to do is
  // notice when the plan is exhausted and fetch the next one.
  useEffect(() => {
    if (!connected || !isReady) return;
    if (trackTargetMoves.length === 0 || trackDoneMoves.length === 0) return;
    if (trackRemainingMoves.length > 0) return;
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    fetchHintForCurrentPhase().finally(() => {
      fetchInFlightRef.current = false;
    });
  }, [connected, isReady, trackTargetMoves, trackDoneMoves.length, trackRemainingMoves.length, fetchHintForCurrentPhase]);

  // Leaving Guided while connected (switching tabs mid-solve) would otherwise leave the
  // shared tracker holding Guided's last plan for whichever view mounts next — re-anchor it
  // to the Scramble tab's own scramble so e.g. ScrambleView doesn't render Guided's leftover
  // plan as if it were the WCA scramble.
  useEffect(() => {
    return () => {
      const s = useAppStore.getState();
      s.setTrackTarget(s.scrambleMoves);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-seed the walkthrough when the yellow-up display preference is toggled mid-solve — the
  // plan's move frame (raw vs post-z2) depends on it. Skip the initial mount; the init effect
  // already fetches.
  const yellowUpToggleMountRef = useRef(true);
  useEffect(() => {
    if (yellowUpToggleMountRef.current) {
      yellowUpToggleMountRef.current = false;
      return;
    }
    if (connected && isReady) fetchHintForCurrentPhase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedYellowUp]);

  // Connected: track solve timing and save a `mode: 'guided'` Solve when the cube is solved.
  useEffect(() => {
    if (!connected) {
      solveStartRef.current = null;
      solveSavedRef.current = false;
      return;
    }
    const hp = getHintPattern();
    if (!hp) return;
    const solved = evaluateCFOPFromPattern(hp).currentPhase === 'solved';

    if (!solved) {
      solveSavedRef.current = false;
      if (!solveStartRef.current) {
        solveStartRef.current = { ts: performance.now(), moveCount: useCubeStore.getState().moveHistory.length };
      }
    } else if (solveStartRef.current && !solveSavedRef.current) {
      const started = solveStartRef.current;
      solveSavedRef.current = true;
      solveStartRef.current = null;
      const totalMoves = Math.max(0, useCubeStore.getState().moveHistory.length - started.moveCount);
      if (totalMoves > 0) {
        void saveSolve({
          profileId: currentProfileId,
          scrambleMoves: [],
          mode: 'guided',
          cubeConnected: true,
          phases: [],
          totalTimeMs: Math.round(performance.now() - started.ts),
          totalMoves,
        });
      }
    }
  }, [connected, physicalPattern, getHintPattern, currentProfileId]);

  const handleTierChange = (newTier: TechniqueTier) => {
    setTechniqueTier(newTier);
    fetchHintForCurrentPhase(newTier, notationMode, true);
  };

  const handleNotationChange = (newMode: NotationMode) => {
    setNotationMode(newMode);
    fetchHintForCurrentPhase(techniqueTier, newMode, true);
  };

  /** Explicit user "Recalculate" — a fresh matcher hint, never the loop-guard escalation. */
  const handleRecalculate = () => fetchHintForCurrentPhase(undefined, undefined, true);

  // --- No-cube manual stepping (virtual `applyMove`); hidden when a cube is connected. ---
  const handleExecuteNextMove = useCallback(() => {
    if (connected || !currentHint || currentHint.moves.length === 0) return;
    if (hintMoveIndex < currentHint.moves.length) {
      const move = currentHint.moves[hintMoveIndex];
      if (move) {
        applyMove(move);
        const nextIdx = hintMoveIndex + 1;
        setHintMoveIndex(nextIdx);
        if (nextIdx >= currentHint.moves.length) {
          setTimeout(() => fetchHintForCurrentPhase(), 80);
        }
      }
    }
  }, [connected, currentHint, hintMoveIndex, applyMove, fetchHintForCurrentPhase]);

  const handleStepBackMove = useCallback(() => {
    if (connected || hintMoveIndex === 0) return;
    undoLastMove();
    setHintMoveIndex((prev) => prev - 1);
  }, [connected, hintMoveIndex, undoLastMove]);

  const handleResetHintProgress = useCallback(() => {
    if (connected || hintMoveIndex === 0) return;
    undoMoves(hintMoveIndex);
    setHintMoveIndex(0);
  }, [connected, hintMoveIndex, undoMoves]);

  const handleJumpToHintIndex = useCallback(
    (targetIdx: number) => {
      if (connected || !currentHint) return;
      if (targetIdx < hintMoveIndex) {
        undoMoves(hintMoveIndex - targetIdx);
        setHintMoveIndex(targetIdx);
      } else if (targetIdx > hintMoveIndex) {
        for (const m of currentHint.moves.slice(hintMoveIndex, targetIdx)) applyMove(m);
        setHintMoveIndex(targetIdx);
      }
    },
    [connected, currentHint, hintMoveIndex, undoMoves, applyMove]
  );

  // --- Derived UI state ---
  const phase = livePhase;
  const isSolved = phase === 'solved';

  let stageSubtitle = 'Cross Phase';
  if (phase === 'cross') {
    stageSubtitle = 'White Cross — align 4 bottom edges';
  } else if (phase.startsWith('f2l')) {
    const slotIdx = liveSolvedSlots.length + 1;
    stageSubtitle = `F2L — slot ${Math.min(slotIdx, 4)} of 4 (${
      techniqueTier === '2look' ? 'Standard F2L' : 'Rotationless-Preferred'
    }) · ${notationMode === 'simplified' ? 'Simplified' : 'Standard'}`;
  } else if (phase === 'oll') {
    stageSubtitle =
      techniqueTier === 'fullCFOP'
        ? `Full 1-Look OLL — ${currentHint?.caseName || 'Orient Top Layer'}`
        : `2-Look OLL — ${currentHint?.caseName || 'Yellow Cross & Corners'}`;
  } else if (phase === 'pll' || phase === 'auf') {
    stageSubtitle =
      techniqueTier === '2look'
        ? `2-Look PLL — ${currentHint?.caseName || 'Corners & Edges'}`
        : `Full 1-Look PLL — ${currentHint?.caseName || 'Permute Last Layer'}`;
  } else if (phase === 'solved') {
    stageSubtitle = 'Cube Solved!';
  }

  // Connected walks through `planRemaining` (raw frame); no-cube steps `currentHint.moves`.
  const hasValidMoves = connected
    ? planRemaining.length > 0
    : !!currentHint && currentHint.moves.length > 0;
  const currentExpectedMove = connected
    ? planRemaining[0] ?? null
    : hasValidMoves && hintMoveIndex < currentHint!.moves.length
    ? currentHint!.moves[hintMoveIndex]
    : null;

  const progressiveAlg = moveHistory.map((m) => m.move).join(' ').trim();
  const cubeHeight = isDesktop ? 380 : 215;
  // No-cube: the hint move stream is generated in the app's post-z2 frame, so the setup carries
  // the matching `z2` (this is the original last-layer-up view for OLL/PLL practice). Untouched.
  // Connected: default is to mirror the cube exactly as its sensor reports it (`visualAlg`, raw
  // frame). With the `connectedYellowUp` preference on, render yellow-face-up instead —
  // `z2` setup + `toZ2DisplayAlg(visualAlg)` — but only while `visualAlg` is all face turns
  // (a reconstructed rotated frame carries a rotation token the display relabel can't handle;
  // fall back to the raw view then).
  const connectedYellow = connected && connectedYellowUp && isAllFaceTurns(visualAlg);
  const setupAlg = connected
    ? connectedYellow
      ? 'z2'
      : ''
    : currentScramble
    ? `${currentScramble} z2`
    : 'z2';
  const viewAlg = connected ? (connectedYellow ? toZ2DisplayAlg(visualAlg) : visualAlg) : progressiveAlg;

  const TIERS: { id: TechniqueTier; label: string }[] = [
    { id: '2look', label: '2-Look' },
    { id: 'fullPLL', label: 'Full PLL' },
    { id: 'fullCFOP', label: 'Full CFOP' },
  ];

  const tierBar = (
    <div className="flex items-center gap-1 bg-[var(--surface)] border border-[var(--border)] p-1 rounded-xl">
      {TIERS.map((t) => (
        <button
          key={t.id}
          onClick={() => handleTierChange(t.id)}
          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-heading font-medium transition-all cursor-pointer text-center ${
            techniqueTier === t.id
              ? 'bg-[var(--white)] text-[var(--bg)] font-semibold shadow-xs'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const notationBar = (
    <div className="flex items-center gap-1 bg-[var(--surface)] border border-[var(--border)] p-1 rounded-xl">
      {(['simplified', 'standard'] as NotationMode[]).map((m) => (
        <button
          key={m}
          onClick={() => handleNotationChange(m)}
          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-heading font-medium transition-all cursor-pointer text-center ${
            notationMode === m
              ? 'bg-[var(--white)] text-[var(--bg)] font-semibold shadow-xs'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          {m === 'simplified' ? 'Simplified Moves' : 'Standard Notation'}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-12 lg:gap-8 flex-1 pb-4">
      {/* Mobile Header Bar */}
      <div className="flex lg:hidden items-center justify-between mb-2">
        <div>
          <h1 className="font-heading font-semibold text-xl tracking-tight text-[var(--text)]">Guided solve</h1>
          <div className="text-xs text-[var(--text-muted)] font-medium">{stageSubtitle}</div>
        </div>
        <button
          onClick={handleRecalculate}
          disabled={isCalculating}
          className="flex items-center gap-1 text-xs font-heading font-medium text-[var(--text-muted)] hover:text-[var(--text)] bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isCalculating ? 'animate-spin' : ''}`} />
          <span>Recalculate</span>
        </button>
      </div>

      {/* Mobile Settings Bars */}
      <div className="flex lg:hidden flex-col gap-1.5 mb-3">
        {tierBar}
        {notationBar}
      </div>

      {/* LEFT COLUMN: Large 3D Visualizer & PhaseRail */}
      <div className="lg:col-span-5 xl:col-span-5 flex flex-col justify-between mb-3 lg:mb-0 gap-3">
        <div
          className={`bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 flex items-center justify-center min-h-[225px] lg:min-h-[420px] lg:flex-1 relative transition-shadow duration-300 ${trackFeedbackPanelClass(
            feedback?.kind ?? null
          )}`}
        >
          {isCalculating && !connected ? (
            <div className="flex flex-col items-center justify-center gap-2 text-sm text-[var(--text-muted)] font-heading">
              <RefreshCw className="w-5 h-5 animate-spin text-[var(--white)]" />
              <span>Calculating guidance…</span>
            </div>
          ) : (
            <TwistyPlayerWrapper setupAlg={setupAlg} alg={viewAlg} tempoScale={2.5} height={cubeHeight} />
          )}
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-[var(--surface-2)]/90 border border-[var(--border)] text-xs font-mono text-[var(--text-muted)] backdrop-blur-xs">
            {isSolved ? 'Solved' : PHASE_DISPLAY_NAMES[phase] || phase}
          </div>
          {connected && (
            <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-[var(--green)]/10 border border-[var(--green)]/30 text-[11px] font-mono text-[var(--green)]">
              live cube
            </div>
          )}
        </div>

        <div className="hidden lg:block">
          <PhaseRail currentPhase={phase} solvedSlots={liveSolvedSlots} />
        </div>
      </div>

      {/* RIGHT COLUMN */}
      <div className="lg:col-span-7 xl:col-span-7 flex flex-col justify-between">
        {/* Desktop Header */}
        <div className="hidden lg:flex items-center justify-between mb-3 pb-2 border-b border-[var(--border)]/50">
          <div>
            <h1 className="font-heading font-semibold text-2xl tracking-tight text-[var(--text)]">Guided Solve</h1>
            <div className="text-xs text-[var(--text-muted)] font-medium mt-0.5">{stageSubtitle}</div>
          </div>
          <button
            onClick={handleRecalculate}
            disabled={isCalculating}
            className="flex items-center gap-1.5 text-xs font-heading font-medium text-[var(--text)] bg-[var(--surface-2)] hover:bg-[var(--border)] border border-[var(--border)] rounded-xl px-3 py-2 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCalculating ? 'animate-spin' : ''}`} />
            <span>Recalculate</span>
          </button>
        </div>

        {/* Desktop Settings Bars */}
        <div className="hidden lg:grid grid-cols-2 gap-2 mb-3">
          {tierBar}
          {notationBar}
        </div>

        {/* Next Move Callout Card & Controls */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3.5 lg:p-4 mb-3 relative z-10 shadow-xs">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium">
              {isSolved
                ? 'Status'
                : hasValidMoves
                ? connected
                  ? `Next Move (${planDone.length + 1} of ${planDone.length + planRemaining.length})${
                      currentHint?.caseName ? ` · ${currentHint.caseName}` : ''
                    }`
                  : `Next Move (${hintMoveIndex + 1} of ${currentHint!.moves.length}) · ${currentHint!.caseName}`
                : 'Guidance Status'}
            </div>
            {connected && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[var(--green)] bg-[var(--green)]/10 border border-[var(--green)]/30 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />
                <span>tracking turns</span>
              </span>
            )}
          </div>

          {isSolved ? (
            <div className="flex items-center gap-2.5 text-[var(--green)] py-1">
              <CheckCircle2 className="w-6 h-6 shrink-0" />
              <div>
                <div className="font-heading font-semibold text-sm">Cube is Solved!</div>
                <div className="text-xs text-[var(--text-muted)]">All CFOP stages successfully completed</div>
              </div>
            </div>
          ) : hasValidMoves && currentExpectedMove ? (
            <div className="flex items-center gap-3">
              <div
                className={`font-mono text-2xl lg:text-3xl font-bold px-3 py-1.5 rounded-xl shadow-xs shrink-0 min-w-[58px] text-center border transition-colors ${trackFeedbackBadgeClass(
                  feedback?.kind ?? null
                )}`}
              >
                {currentExpectedMove}
              </div>
              <div className="min-w-0 flex-1">
                {feedback ? (
                  <TrackFeedbackMessage feedback={feedback} />
                ) : (
                  <div className="text-xs lg:text-sm font-semibold text-[var(--text)] truncate">
                    {getMoveDescription(currentExpectedMove)}
                  </div>
                )}
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  {connected ? 'Turn your cube — the guide follows every move' : 'Execute on physical cube, or tap Next move below'}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-2 text-center text-xs text-[var(--text-muted)]">
              {isCalculating ? 'Computing optimal move sequence…' : 'Phase complete · Ready for next step'}
            </div>
          )}

          {/* Manual stepping toolbar — no-cube only */}
          {!connected && !isSolved && hasValidMoves && (
            <div className="flex items-center justify-end gap-1.5 mt-3 pt-3 border-t border-[var(--border)]/60">
              <button
                onClick={handleStepBackMove}
                disabled={hintMoveIndex === 0}
                title="Previous move in hint"
                className="p-2 rounded-xl bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleExecuteNextMove}
                disabled={hintMoveIndex >= currentHint!.moves.length}
                title="Advance move"
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-[var(--white)] text-[var(--bg)] font-heading font-semibold text-xs hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer shadow-xs"
              >
                <span>Step</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleResetHintProgress}
                disabled={hintMoveIndex === 0}
                title="Reset current hint progress"
                className="p-2 rounded-xl bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Hint Move Ribbon */}
        <div className="mb-3">
          {(connected ? planDone.length + planRemaining.length > 0 : currentHint && currentHint.moves.length > 0) ? (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3.5 lg:p-4">
              <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-2 text-center">
                {currentHint?.caseName ? `${currentHint.caseName} Algorithm` : 'Algorithm Sequence'}
              </div>
              <div className="font-mono text-sm font-medium leading-relaxed tracking-wide flex flex-wrap gap-1.5 justify-center py-1">
                {(connected
                  ? [...planDone.map((m) => ({ m, done: true })), ...planRemaining.map((m) => ({ m, done: false }))]
                  : currentHint!.moves.map((m, idx) => ({ m, done: idx < hintMoveIndex }))
                ).map((entry, idx, arr) => {
                  const remainingPos = idx - planDone.length;
                  const isCorrection =
                    connected && !!feedback && !entry.done && remainingPos >= 0 && remainingPos < feedback.corrections.length;
                  const isCurrent =
                    !isCorrection &&
                    (connected ? !entry.done && (idx === 0 || arr[idx - 1].done) : idx === hintMoveIndex);
                  return (
                    <button
                      key={idx}
                      onClick={() => !connected && handleJumpToHintIndex(idx)}
                      disabled={connected}
                      className={`px-2 py-1 rounded-md text-xs font-mono transition-all ${connected ? '' : 'cursor-pointer'} ${
                        entry.done
                          ? 'text-[var(--text-muted)] opacity-40 line-through bg-transparent'
                          : isCorrection
                          ? trackFeedbackChipClass(feedback?.kind ?? null)
                          : isCurrent
                          ? 'bg-[var(--white)] text-[var(--bg)] font-bold shadow-xs scale-105 ring-2 ring-[var(--white)]/30'
                          : 'text-[var(--text)] bg-[var(--surface-2)] hover:bg-[var(--border)]'
                      }`}
                    >
                      {entry.m}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center my-2 py-2">
              <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-medium mb-1">Phase status</div>
              <div className="font-mono text-xl text-[var(--green)]">
                {isSolved ? 'Cube is Solved!' : 'Ready for next phase'}
              </div>
            </div>
          )}
        </div>

        {/* Mobile Phase Rail */}
        <div className="block lg:hidden mb-3">
          <PhaseRail currentPhase={phase} solvedSlots={liveSolvedSlots} />
        </div>

        {/* Bottom Action CTAs */}
        <div className="mt-auto flex flex-col sm:flex-row gap-2 pt-2">
          {isSolved ? (
            <button
              onClick={() => setMode('scramble')}
              className="flex-1 py-3.5 rounded-xl font-heading font-semibold text-[15px] bg-[var(--white)] text-[var(--bg)] hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Start New Scramble</span>
            </button>
          ) : connected ? (
            <div className="flex-1 py-3 rounded-xl text-center text-[13px] text-[var(--text-muted)] bg-[var(--surface)] border border-[var(--border)]">
              Turn your cube to follow the guide. Use the header resync if the picture drifts.
            </div>
          ) : (
            <button
              onClick={handleExecuteNextMove}
              disabled={!hasValidMoves || hintMoveIndex >= currentHint!.moves.length || isCalculating}
              className="flex-1 py-3.5 rounded-xl font-heading font-semibold text-[15px] bg-[var(--white)] text-[var(--bg)] hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowRight className="w-4 h-4" />
              <span>Next move ({currentExpectedMove || '—'})</span>
            </button>
          )}

          <button
            onClick={handleRecalculate}
            disabled={isCalculating}
            className="flex-1 py-3 rounded-xl font-heading font-medium text-[13px] bg-transparent border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface)] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Recalculate</span>
          </button>
        </div>
      </div>
    </div>
  );
};
