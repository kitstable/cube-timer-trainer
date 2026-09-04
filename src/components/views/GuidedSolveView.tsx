import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Alg } from 'cubing/alg';
import { RefreshCw, ArrowRight, RotateCw, ChevronLeft, ChevronRight, CheckCircle2, RotateCcw } from 'lucide-react';
import { TwistyPlayerWrapper } from '../TwistyPlayerWrapper';
import { PhaseRail } from '../ui/PhaseRail';
import { useCubeStore } from '../../store/useCubeStore';
import { useAppStore } from '../../store/useAppStore';
import { useSolverWorker } from '../../hooks/useSolverWorker';
import { evaluateCFOPFromPattern } from '../../utils/phaseDetector';
import { classifyScrambleMove } from '../../utils/scrambleTracker';
import { createScramblePartialGate, type ScramblePartialGate } from '../../utils/scramblePartialGate';
import { relabelMoveZ2 } from '../../utils/kpuzzleHelper';
import { saveSolve } from '../../db/repository';
import { PHASE_DISPLAY_NAMES, ALL_F2L_SLOTS, getMoveDescription, SCRAMBLE_PARTIAL_GRACE_MS } from '../../utils/constants';
import type { CFOPPhase, F2LSlotId, MoveHint, ScrambleFeedback, TechniqueTier, NotationMode } from '../../types/cube';
import { useIsDesktop } from '../../hooks/useMediaQuery';

/**
 * Guided Solve — a CFOP teaching walkthrough.
 *
 * With a smart cube connected the hint is computed from the *live* physical `KPattern`
 * (`physicalPattern · z2`) — no fabricated scramble, no independent state. It then walks you
 * through that hint one move at a time: each correct physical turn ticks the next move off
 * (via the same pure `classifyScrambleMove` tracker the Scramble guide uses, so half-turns,
 * commuting moves etc. are handled). A wrong/unexpected turn, or finishing the current step,
 * recomputes a fresh hint from the real state — so the guide is always correct without
 * fragile "undo the mistake" logic, but it doesn't churn a new alg on every single turn.
 *
 * Without a cube it's the manual practice path: seed from the Scramble-tab scramble (or make
 * one), and step through the hint with the Next-move button / ribbon (virtual `applyMove`).
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
  const { currentScramble, currentProfileId, setScramble: setAppScramble, setMode, techniqueTier, setTechniqueTier, notationMode, setNotationMode } =
    useAppStore();
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

  // Connected: live progress through the current hint. `planRemaining` / `planDone` are in
  // the raw smart-cube move frame (what you physically turn); the refs mirror them for the
  // move-consuming effect. `consumedMovesRef` marks how far into `moveHistory` we've read.
  const [planRemaining, setPlanRemaining] = useState<string[]>([]);
  const [planDone, setPlanDone] = useState<string[]>([]);
  /** Transient wrong-turn / half-turn cue, mirroring the Scramble guide's feedback. */
  const [feedback, setFeedback] = useState<ScrambleFeedback | null>(null);
  const planRawRef = useRef<string[]>([]);
  const planDoneRef = useRef<string[]>([]);
  const planCorrectionRef = useRef<boolean>(false);
  const consumedMovesRef = useRef<number>(0);
  const recomputingRef = useRef<boolean>(false);
  // Same half-turn deferral the Scramble guide uses: a physical `R2` arrives as two `R`
  // events, so the first would otherwise flash the amber "half turn" cue for ~50ms until
  // the second lands. The gate holds a `partial` for the grace window; a second turn in
  // that window commits the held one and a clean double resolves to `progress` with no
  // flash. `applyPlanMoveRef` is re-pointed each render so the gate always commits through
  // the current `fetchHintForCurrentPhase` closure.
  const partialGateRef = useRef<ScramblePartialGate | null>(null);
  const applyPlanMoveRef = useRef<(mv: string) => void>(() => {});

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
      // Snapshot the move count *now* — the hint is computed from the cube state as of this
      // moment, so any turns made during the (async) `findHint` round-trip must still be
      // classified against the new plan afterwards, not silently swallowed.
      const moveCountAtFetch = useCubeStore.getState().moveHistory.length;

      const status = evaluateCFOPFromPattern(hintPattern);
      const phase = status.currentPhase;
      setLivePhase(phase);
      setLiveSolvedSlots(status.solvedSlots);

      const activeTier = tierOverride || techniqueTier;
      const activeNotation = notationOverride || notationMode;
      setIsCalculating(true);
      recomputingRef.current = true;
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
          setFeedback(null);
          // Seed live walkthrough tracking against this hint (raw smart-cube frame).
          const raw = moves.map(relabelMoveZ2);
          planRawRef.current = raw;
          planDoneRef.current = [];
          planCorrectionRef.current = false;
          partialGateRef.current?.reset(); // drop any half-turn held against the old plan
          setPlanRemaining(raw);
          setPlanDone([]);
          consumedMovesRef.current = moveCountAtFetch;
        }
      } catch (err) {
        console.warn('Failed to calculate guidance hint:', err);
      } finally {
        setIsCalculating(false);
        recomputingRef.current = false;
      }
    },
    [getHintPattern, isReady, findHint, techniqueTier, notationMode]
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

  // Commit one physical turn to the walkthrough plan. Classified by the pure
  // `classifyScrambleMove` (the Scramble guide's tracker): a match ticks a move off; a
  // wrong / half turn keeps the plan, raises the cue and prepends correction move(s) so the
  // guide leads you back on track (not a new alg); a rotation is a no-op. Only *finishing*
  // the step (`complete`) recomputes the next hint. The cue is NOT time-faded — this
  // function is the only thing that changes it (progress/complete clear it, wrong/half
  // replace it, rotation leaves it), so it can't drift out of sync with `planRemaining`.
  const applyPlanMove = useCallback(
    (mv: string) => {
      const cls = classifyScrambleMove(planRawRef.current, planDoneRef.current, mv, planCorrectionRef.current);
      if (cls.kind === 'ignored') return;
      if (cls.kind === 'complete') {
        setFeedback(null);
        partialGateRef.current?.reset();
        fetchHintForCurrentPhase();
        return;
      }
      planDoneRef.current = cls.nextDone;
      planCorrectionRef.current = cls.correctionActive;
      setPlanRemaining(cls.nextRemaining);
      setPlanDone(cls.nextDone);
      setFeedback(
        cls.kind === 'error'
          ? { kind: 'error', corrections: cls.corrections, at: Date.now() }
          : cls.kind === 'partial'
          ? { kind: 'partial', corrections: cls.corrections, at: Date.now() }
          : null
      );
    },
    [fetchHintForCurrentPhase]
  );
  applyPlanMoveRef.current = applyPlanMove;

  if (partialGateRef.current === null) {
    partialGateRef.current = createScramblePartialGate({
      classify: (mv) =>
        classifyScrambleMove(planRawRef.current, planDoneRef.current, mv, planCorrectionRef.current).kind,
      commit: (mv) => applyPlanMoveRef.current(mv),
      graceMs: SCRAMBLE_PARTIAL_GRACE_MS,
    });
  }

  // Connected: consume new physical turns and walk through the current hint via the
  // half-turn gate (so a double turn doesn't flash the "half turn" cue between its halves).
  // `isCalculating` is a dep so this re-runs the moment a recompute finishes — any turns made
  // during the async `findHint` window (when this effect early-returns) are then flushed and
  // classified against the fresh plan rather than sitting unprocessed until the next turn.
  useEffect(() => {
    if (!connected || !isReady || recomputingRef.current) return;
    const hist = useCubeStore.getState().moveHistory;
    if (hist.length < consumedMovesRef.current) {
      // History shrank (header resync / calibrate) — plan is stale, start fresh.
      consumedMovesRef.current = hist.length;
      partialGateRef.current?.reset();
      fetchHintForCurrentPhase();
      return;
    }
    if (hist.length === consumedMovesRef.current) return;
    const fresh = hist.slice(consumedMovesRef.current).map((m) => m.move);
    consumedMovesRef.current = hist.length;

    if (planRawRef.current.length === 0) {
      fetchHintForCurrentPhase();
      return;
    }

    for (const mv of fresh) {
      partialGateRef.current!.feed(mv);
      // A `complete` synchronously kicked off a refetch (recomputingRef set before its
      // first await) — stop; the rest of `fresh` is already folded into the new read.
      if (recomputingRef.current) break;
    }
  }, [connected, isReady, physicalPattern, isCalculating, fetchHintForCurrentPhase]);

  // Drop any held half-turn when the cube disconnects or the view unmounts, so its grace
  // timer can't fire into a stale plan / unmounted component.
  useEffect(() => {
    if (!connected) partialGateRef.current?.reset();
    return () => partialGateRef.current?.reset();
  }, [connected]);

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
  // Connected: mirror the cube exactly as its sensor reports it (`visualAlg`, raw frame).
  // No-cube: the hint move stream is generated in the app's post-z2 frame, so the setup carries
  // the matching `z2` (this is the original last-layer-up view for OLL/PLL practice).
  const setupAlg = connected ? '' : currentScramble ? `${currentScramble} z2` : 'z2';
  const viewAlg = connected ? visualAlg : progressiveAlg;

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
          className={`bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 flex items-center justify-center min-h-[225px] lg:min-h-[420px] lg:flex-1 relative transition-shadow duration-300 ${
            feedback?.kind === 'error'
              ? 'ring-2 ring-[var(--red)] shadow-[0_0_0_4px_rgba(200,16,46,0.28)]'
              : feedback?.kind === 'partial'
              ? 'ring-2 ring-[var(--orange)]'
              : ''
          }`}
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
                className={`font-mono text-2xl lg:text-3xl font-bold px-3 py-1.5 rounded-xl shadow-xs shrink-0 min-w-[58px] text-center border transition-colors ${
                  feedback?.kind === 'error'
                    ? 'bg-[var(--red)]/15 text-[var(--red)] border-[var(--red)]/40'
                    : feedback?.kind === 'partial'
                    ? 'bg-[var(--orange)]/15 text-[var(--orange)] border-[var(--orange)]/40'
                    : 'bg-[var(--surface-2)] text-[var(--white)] border-[var(--border)]'
                }`}
              >
                {currentExpectedMove}
              </div>
              <div className="min-w-0 flex-1">
                {feedback?.kind === 'error' ? (
                  <div className="text-xs font-semibold text-[var(--red)]">
                    Wrong turn — do {feedback.corrections.join(' ')} to get back on track
                  </div>
                ) : feedback?.kind === 'partial' ? (
                  <div className="text-xs font-semibold text-[var(--orange)]">
                    Half turn — keep turning this face to {feedback.corrections.join(' ')}
                  </div>
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
                          : isCorrection && feedback?.kind === 'error'
                          ? 'bg-[var(--red)]/15 text-[var(--red)] ring-1 ring-[var(--red)]/40 font-bold'
                          : isCorrection
                          ? 'bg-[var(--orange)]/15 text-[var(--orange)] ring-1 ring-[var(--orange)]/40 font-bold'
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
