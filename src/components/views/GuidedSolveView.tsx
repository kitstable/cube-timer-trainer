import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ArrowRight, RotateCw, Play, Pause, ChevronLeft, ChevronRight, CheckCircle2, RotateCcw } from 'lucide-react';
import { TwistyPlayerWrapper } from '../TwistyPlayerWrapper';
import { PhaseRail } from '../ui/PhaseRail';
import { useCubeStore } from '../../store/useCubeStore';
import { useAppStore } from '../../store/useAppStore';
import { useSolverWorker } from '../../hooks/useSolverWorker';
import { PHASE_DISPLAY_NAMES, ALL_F2L_SLOTS, getMoveDescription } from '../../utils/constants';
import type { MoveHint, TechniqueTier, NotationMode } from '../../types/cube';

export const GuidedSolveView: React.FC = () => {
  const { pattern, monotonicPhase, solvedSlots, moveHistory, applyMove, undoLastMove, undoMoves, setScramble: setCubeStoreScramble } = useCubeStore();
  const { currentScramble, setScramble: setAppScramble, setMode, techniqueTier, setTechniqueTier, notationMode, setNotationMode } = useAppStore();
  const { findHint, generateScramble, isReady } = useSolverWorker();

  const [currentHint, setCurrentHint] = useState<MoveHint | null>(null);
  const [hintMoveIndex, setHintMoveIndex] = useState<number>(0);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [isAutoAdvancing, setIsAutoAdvancing] = useState<boolean>(false);

  // Sync scramble to pattern on mount or generate if empty
  useEffect(() => {
    const initScrambleState = async () => {
      const state = useCubeStore.getState();
      if (currentScramble) {
        if (!state.pattern || (state.moveHistory.length === 0 && (state.monotonicPhase === 'solved' || state.scramblePattern === null))) {
          await setCubeStoreScramble(currentScramble);
        }
      } else if (isReady) {
        try {
          const res = await generateScramble();
          setAppScramble(res.scramble, res.moves);
          await setCubeStoreScramble(res.scramble);
        } catch (err) {
          console.warn('Failed to auto-generate scramble for guided solve:', err);
        }
      }
    };
    initScrambleState();
  }, [currentScramble, isReady, setCubeStoreScramble, setAppScramble, generateScramble]);

  // Fetch hint for the active phase and lock it
  const fetchHintForCurrentPhase = useCallback(
    async (tierOverride?: TechniqueTier, notationOverride?: NotationMode) => {
      const currentPattern = useCubeStore.getState().pattern;
      const currentPhase = useCubeStore.getState().monotonicPhase;
      const currentSolvedSlots = useCubeStore.getState().solvedSlots;

      if (!currentPattern || !isReady) return;

      const activeTier = tierOverride || techniqueTier;
      const activeNotation = notationOverride || notationMode;
      setIsCalculating(true);

      try {
        // If in F2L phase, find the next unsolved slot
        const nextUnsolvedSlot = ALL_F2L_SLOTS.find((s) => !currentSolvedSlots.includes(s));
        const res = await findHint(currentPhase, currentPattern.patternData, nextUnsolvedSlot, activeTier, activeNotation);
        if (res) {
          const hintPhase = (res.phase || currentPhase) as any;
          setCurrentHint({
            phase: hintPhase,
            phaseName: (PHASE_DISPLAY_NAMES as any)[hintPhase] || hintPhase,
            moves: res.moves || [],
            currentIndex: 0,
            caseName: res.caseName || 'Guidance',
            rawAlg: (res.moves || []).join(' '),
          });
          setHintMoveIndex(0);
        }
      } catch (err) {
        console.warn('Failed to calculate guidance hint:', err);
      } finally {
        setIsCalculating(false);
      }
    },
    [isReady, findHint, techniqueTier, notationMode]
  );

  // Initial hint fetch when solver and cube pattern are ready
  useEffect(() => {
    if (isReady && pattern && !currentHint) {
      fetchHintForCurrentPhase();
    }
  }, [isReady, pattern, currentHint, fetchHintForCurrentPhase]);

  const handleTierChange = (newTier: TechniqueTier) => {
    setTechniqueTier(newTier);
    setIsAutoAdvancing(false);
    fetchHintForCurrentPhase(newTier, notationMode);
  };

  const handleNotationChange = (newMode: NotationMode) => {
    setNotationMode(newMode);
    setIsAutoAdvancing(false);
    fetchHintForCurrentPhase(techniqueTier, newMode);
  };

  // Advance single move in hint (when tapping "Next move" or "Step")
  const handleExecuteNextMove = useCallback(() => {
    if (!currentHint || currentHint.moves.length === 0) return;

    if (hintMoveIndex < currentHint.moves.length) {
      const move = currentHint.moves[hintMoveIndex];
      if (move) {
        applyMove(move);
        const nextIdx = hintMoveIndex + 1;
        setHintMoveIndex(nextIdx);

        // ONLY when all moves in this hint/case are completed, fetch the next stage hint!
        if (nextIdx >= currentHint.moves.length) {
          setTimeout(() => {
            fetchHintForCurrentPhase();
          }, 80);
        }
      }
    }
  }, [currentHint, hintMoveIndex, applyMove, fetchHintForCurrentPhase]);

  // Step back 1 move (undo last move on cube and 3D visualizer)
  const handleStepBackMove = useCallback(() => {
    setIsAutoAdvancing(false);
    if (hintMoveIndex > 0) {
      undoLastMove();
      setHintMoveIndex((prev) => prev - 1);
    }
  }, [hintMoveIndex, undoLastMove]);

  // Reset progress of the current algorithm sequence
  const handleResetHintProgress = useCallback(() => {
    setIsAutoAdvancing(false);
    if (hintMoveIndex > 0) {
      undoMoves(hintMoveIndex);
      setHintMoveIndex(0);
    }
  }, [hintMoveIndex, undoMoves]);

  // Jump to specific index in algorithm ribbon
  const handleJumpToHintIndex = useCallback((targetIdx: number) => {
    setIsAutoAdvancing(false);
    if (!currentHint) return;

    if (targetIdx < hintMoveIndex) {
      const movesToUndo = hintMoveIndex - targetIdx;
      undoMoves(movesToUndo);
      setHintMoveIndex(targetIdx);
    } else if (targetIdx > hintMoveIndex) {
      const movesToApply = currentHint.moves.slice(hintMoveIndex, targetIdx);
      for (const m of movesToApply) {
        applyMove(m);
      }
      setHintMoveIndex(targetIdx);
    }
  }, [currentHint, hintMoveIndex, undoMoves, applyMove]);


  // Auto-advance through the guided walkthrough with a 2-second delay
  useEffect(() => {
    if (!isAutoAdvancing) return;

    if (!currentHint || currentHint.moves.length === 0 || monotonicPhase === 'solved') {
      setIsAutoAdvancing(false);
      return;
    }

    const timer = setInterval(() => {
      handleExecuteNextMove();
    }, 2000);

    return () => clearInterval(timer);
  }, [isAutoAdvancing, currentHint, monotonicPhase, handleExecuteNextMove]);

  // Stage description subtitle
  let stageSubtitle = 'Cross Phase';
  if (monotonicPhase === 'cross') {
    stageSubtitle = 'White Cross — align 4 bottom edges';
  } else if (monotonicPhase.startsWith('f2l')) {
    const slotIdx = solvedSlots.length + 1;
    stageSubtitle = `F2L — slot ${Math.min(slotIdx, 4)} of 4 (${techniqueTier === '2look' ? 'Standard F2L' : 'Rotationless-Preferred'}) · ${notationMode === 'simplified' ? 'Simplified' : 'Standard'}`;
  } else if (monotonicPhase === 'oll') {
    stageSubtitle = techniqueTier === 'fullCFOP'
      ? `Full 1-Look OLL — ${currentHint?.caseName || 'Orient Top Layer'}`
      : `2-Look OLL — ${currentHint?.caseName || 'Yellow Cross & Corners'}`;
  } else if (monotonicPhase === 'pll' || monotonicPhase === 'auf') {
    stageSubtitle = techniqueTier === '2look'
      ? `2-Look PLL — ${currentHint?.caseName || 'Corners & Edges'}`
      : `Full 1-Look PLL — ${currentHint?.caseName || 'Permute Last Layer'}`;
  } else if (monotonicPhase === 'solved') {
    stageSubtitle = 'Cube Solved!';
  }

  const isSolved = monotonicPhase === 'solved';
  const hasValidMoves = currentHint && currentHint.moves.length > 0;
  const currentExpectedMove = hasValidMoves && hintMoveIndex < currentHint.moves.length ? currentHint.moves[hintMoveIndex] : null;

  // Build the progressive algorithm for the 3D player: scramble moves + all applied moves so far
  const executedHistoryMoves = moveHistory.map((m) => m.move).join(' ');
  const progressiveAlg = executedHistoryMoves.trim();

  return (
    <div className="flex flex-col flex-1 pb-4">
      {/* Header Bar */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="font-heading font-semibold text-xl tracking-tight text-[var(--text)]">
            Guided solve
          </h1>
          <div className="text-xs text-[var(--text-muted)] font-medium">
            {stageSubtitle}
          </div>
        </div>

        <button
          onClick={() => fetchHintForCurrentPhase()}
          disabled={isCalculating}
          className="flex items-center gap-1 text-xs font-heading font-medium text-[var(--text-muted)] hover:text-[var(--text)] bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isCalculating ? 'animate-spin' : ''}`} />
          <span>Recalculate</span>
        </button>
      </div>

      {/* Two Independent Settings Bars (§10) */}
      <div className="flex flex-col gap-1.5 mb-3">
        {/* Axis 1: Technique Tier (2-Look | Full PLL | Full CFOP) */}
        <div className="flex items-center gap-1 bg-[var(--surface)] border border-[var(--border)] p-1 rounded-xl">
          <button
            onClick={() => handleTierChange('2look')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-heading font-medium transition-all cursor-pointer text-center ${
              techniqueTier === '2look'
                ? 'bg-[var(--white)] text-[var(--bg)] font-semibold shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            2-Look
          </button>
          <button
            onClick={() => handleTierChange('fullPLL')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-heading font-medium transition-all cursor-pointer text-center ${
              techniqueTier === 'fullPLL'
                ? 'bg-[var(--white)] text-[var(--bg)] font-semibold shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            Full PLL
          </button>
          <button
            onClick={() => handleTierChange('fullCFOP')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-heading font-medium transition-all cursor-pointer text-center ${
              techniqueTier === 'fullCFOP'
                ? 'bg-[var(--white)] text-[var(--bg)] font-semibold shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            Full CFOP
          </button>
        </div>

        {/* Axis 2: Notation Mode (Simplified | Standard) */}
        <div className="flex items-center gap-1 bg-[var(--surface)] border border-[var(--border)] p-1 rounded-xl">
          <button
            onClick={() => handleNotationChange('simplified')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-heading font-medium transition-all cursor-pointer text-center ${
              notationMode === 'simplified'
                ? 'bg-[var(--white)] text-[var(--bg)] font-semibold shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            Simplified Moves
          </button>
          <button
            onClick={() => handleNotationChange('standard')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-heading font-medium transition-all cursor-pointer text-center ${
              notationMode === 'standard'
                ? 'bg-[var(--white)] text-[var(--bg)] font-semibold shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            Standard Notation
          </button>
        </div>
      </div>


      {/* 3D Cube Card */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 mb-3 flex items-center justify-center min-h-[225px] relative">
        {isCalculating ? (
          <div className="flex flex-col items-center justify-center gap-2 text-sm text-[var(--text-muted)] font-heading">
            <RefreshCw className="w-5 h-5 animate-spin text-[var(--white)]" />
            <span>Calculating guidance…</span>
          </div>
        ) : (
          <TwistyPlayerWrapper
            setupAlg={currentScramble ? `${currentScramble} z2` : 'z2'}
            alg={progressiveAlg}
            tempoScale={2.5}
            height={215}
          />
        )}

        {/* Floating Phase Badge */}
        <div className="absolute top-3 left-3 px-2 py-0.5 rounded-md bg-[var(--surface-2)]/90 border border-[var(--border)] text-[11px] font-mono text-[var(--text-muted)] backdrop-blur-xs">
          {isSolved ? 'Solved' : PHASE_DISPLAY_NAMES[monotonicPhase] || monotonicPhase}
        </div>
      </div>

      {/* Next Move Callout Card & Controls (Prominently Visible) */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3.5 mb-3 relative z-10 shadow-xs">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium">
            {isSolved
              ? 'Status'
              : hasValidMoves
              ? `Next Move (${hintMoveIndex + 1} of ${currentHint.moves.length}) · ${currentHint.caseName}`
              : 'Guidance Status'}
          </div>

          {/* Auto-advance status badge */}
          {isAutoAdvancing && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[var(--green)] bg-[var(--green)]/10 border border-[var(--green)]/30 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-ping" />
              <span>Auto 2s</span>
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
            <div className="font-mono text-2xl font-bold text-[var(--white)] bg-[var(--surface-2)] border border-[var(--border)] px-3 py-1 rounded-xl shadow-xs shrink-0 min-w-[54px] text-center">
              {currentExpectedMove}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[var(--text)] truncate">
                {getMoveDescription(currentExpectedMove)}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Execute on physical cube, or tap Next move below
              </div>
            </div>
          </div>
        ) : (
          <div className="py-2 text-center text-xs text-[var(--text-muted)]">
            {isCalculating ? 'Computing optimal move sequence…' : 'Phase complete · Ready for next step'}
          </div>
        )}

        {/* Stepping & Auto-Play Toolbar */}
        {!isSolved && hasValidMoves && (
          <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-[var(--border)]/60">
            <button
              onClick={() => setIsAutoAdvancing((prev) => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-heading font-medium transition-all cursor-pointer ${
                isAutoAdvancing
                  ? 'bg-[var(--green)] text-black font-semibold shadow-xs'
                  : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)]'
              }`}
              title={isAutoAdvancing ? 'Pause auto-walkthrough' : 'Auto-play walkthrough with 2s delay per move'}
            >
              {isAutoAdvancing ? (
                <>
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  <span>Pause (2s)</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Auto (2s)</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-1.5 ml-auto">
              <button
                onClick={handleStepBackMove}
                disabled={hintMoveIndex === 0}
                title="Previous move in hint"
                className="p-2 rounded-xl bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  setIsAutoAdvancing(false);
                  handleExecuteNextMove();
                }}
                disabled={hintMoveIndex >= currentHint.moves.length}
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
          </div>
        )}
      </div>

      {/* Hint Move Ribbon (Interactive move chips) */}
      <div className="mb-3">
        {currentHint && currentHint.moves.length > 0 ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3">
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-2 text-center">
              {currentHint.caseName ? `${currentHint.caseName} Algorithm` : 'Algorithm Sequence'}
            </div>
            <div className="font-mono text-sm font-medium leading-relaxed tracking-wide flex flex-wrap gap-1.5 justify-center py-1">
              {currentHint.moves.map((m, idx) => {
                const isDone = idx < hintMoveIndex;
                const isCurrent = idx === hintMoveIndex;

                return (
                  <button
                    key={idx}
                    onClick={() => handleJumpToHintIndex(idx)}
                    className={`px-2 py-1 rounded-md text-xs font-mono transition-all cursor-pointer ${
                      isDone
                        ? 'text-[var(--text-muted)] opacity-40 line-through bg-transparent'
                        : isCurrent
                        ? 'bg-[var(--white)] text-[var(--bg)] font-bold shadow-xs scale-105 ring-2 ring-[var(--white)]/30'
                        : 'text-[var(--text)] bg-[var(--surface-2)] hover:bg-[var(--border)]'
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>

          </div>
        ) : (
          <div className="text-center my-2 py-2">
            <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-medium mb-1">
              Phase status
            </div>
            <div className="font-mono text-xl text-[var(--green)]">
              {isSolved ? 'Cube is Solved!' : 'Ready for next phase'}
            </div>
          </div>
        )}
      </div>

      {/* Color-to-Structure Phase Rail */}
      <div className="mb-3">
        <PhaseRail
          currentPhase={monotonicPhase}
          solvedSlots={solvedSlots}
        />
      </div>

      {/* Bottom Action CTAs */}
      <div className="mt-auto flex flex-col gap-2 pt-2">
        {isSolved ? (
          <button
            onClick={() => setMode('scramble')}
            className="w-full py-4 rounded-xl font-heading font-semibold text-[15px] bg-[var(--white)] text-[var(--bg)] hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Start New Scramble</span>
          </button>
        ) : (
          <button
            onClick={() => {
              setIsAutoAdvancing(false);
              handleExecuteNextMove();
            }}
            disabled={!hasValidMoves || hintMoveIndex >= currentHint.moves.length || isCalculating}
            className="w-full py-4 rounded-xl font-heading font-semibold text-[15px] bg-[var(--white)] text-[var(--bg)] hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowRight className="w-4 h-4" />
            <span>Next move ({currentExpectedMove || '—'})</span>
          </button>
        )}

        <button
          onClick={() => fetchHintForCurrentPhase()}
          disabled={isCalculating}
          className="w-full py-3 rounded-xl font-heading font-medium text-[13px] bg-transparent border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface)] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <RotateCw className="w-3.5 h-3.5" />
          <span>Resync / Recalculate</span>
        </button>


      </div>
    </div>
  );
};

