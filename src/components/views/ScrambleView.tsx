import React, { useEffect, useState } from 'react';
import { RefreshCw, Play, Pause, Compass, ChevronLeft, ChevronRight, RotateCcw, CheckCheck, CheckCircle2 } from 'lucide-react';
import { TwistyPlayerWrapper } from '../TwistyPlayerWrapper';
import { useAppStore } from '../../store/useAppStore';
import { useCubeStore } from '../../store/useCubeStore';
import { useSolverWorker } from '../../hooks/useSolverWorker';
import { getMoveDescription } from '../../utils/constants';

export const ScrambleView: React.FC = () => {
  const {
    currentScramble,
    scrambleMoves,
    scrambleProgressIndex,
    setScramble,
    setMode,
    setScrambleProgressIndex,
    advanceScrambleProgress,
    stepBackScrambleProgress,
    resetScrambleProgress,
    completeScrambleProgress,
  } = useAppStore();

  const { smartCube, setScramble: setCubeStoreScramble } = useCubeStore();
  const { generateScramble, isReady } = useSolverWorker();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAutoAdvancing, setIsAutoAdvancing] = useState(false);

  const fetchNewScramble = async () => {
    setIsAutoAdvancing(false);
    setIsGenerating(true);
    try {
      const res = await generateScramble();
      setScramble(res.scramble, res.moves);
      await setCubeStoreScramble(res.scramble);
    } catch (err) {
      console.error('Failed to generate scramble:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (isReady && !currentScramble) {
      fetchNewScramble();
    }
  }, [isReady]);

  // Auto-advance through scramble with 2-second delay between moves when enabled
  useEffect(() => {
    if (!isAutoAdvancing || smartCube.isConnected) {
      if (smartCube.isConnected && isAutoAdvancing) {
        setIsAutoAdvancing(false);
      }
      return;
    }

    if (scrambleProgressIndex >= scrambleMoves.length) {
      setIsAutoAdvancing(false);
      return;
    }

    const timer = setInterval(() => {
      useAppStore.getState().advanceScrambleProgress();
    }, 2000);

    return () => clearInterval(timer);
  }, [isAutoAdvancing, scrambleProgressIndex, scrambleMoves.length, smartCube.isConnected]);

  const isComplete = scrambleMoves.length > 0 && scrambleProgressIndex >= scrambleMoves.length;
  const currentExpectedMove = !isComplete && scrambleMoves.length > 0 ? scrambleMoves[scrambleProgressIndex] : null;

  // The 3D cube visualizer displays the progressive scramble algorithm up to scrambleProgressIndex
  const currentProgressiveAlg = scrambleMoves.slice(0, scrambleProgressIndex).join(' ');

  const handleToggleAutoAdvance = () => {
    if (isComplete) {
      resetScrambleProgress();
      setIsAutoAdvancing(true);
    } else {
      setIsAutoAdvancing((prev) => !prev);
    }
  };

  return (
    <div className="flex flex-col flex-1 pb-4">
      {/* Header Bar */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-heading font-semibold text-xl tracking-tight text-[var(--text)]">
          Scramble Cube
        </h1>
        <button
          onClick={fetchNewScramble}
          disabled={isGenerating}
          className="flex items-center gap-1 text-xs font-heading font-medium text-[var(--text-muted)] hover:text-[var(--text)] bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
          <span>New Scramble</span>
        </button>
      </div>

      <div className="text-xs text-[var(--text-muted)] mb-3 flex items-center justify-between">
        <span>Hold White on top (U), Green on front (F)</span>
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          {scrambleProgressIndex} / {scrambleMoves.length}
        </span>
      </div>

      {/* 3D Cube Card - starts Solved and updates progressively move by move */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 mb-3 flex flex-col items-center justify-center min-h-[260px] relative">
        {currentScramble ? (
          <TwistyPlayerWrapper
            setupAlg=""
            alg={currentProgressiveAlg}
            tempoScale={2}
            height={250}
          />
        ) : (
          <div className="flex items-center justify-center text-sm text-[var(--text-muted)]">
            Generating WCA scramble…
          </div>
        )}

        {/* Floating Scramble Step Badge */}
        <div className="absolute top-3 left-3 px-2 py-0.5 rounded-md bg-[var(--surface-2)]/90 border border-[var(--border)] text-[11px] font-mono text-[var(--text-muted)] backdrop-blur-xs">
          {isComplete ? 'Scrambled' : `Step ${scrambleProgressIndex} of ${scrambleMoves.length}`}
        </div>
      </div>

      {/* Next Move Callout Card & Controls (Unobstructed, Dedicated Container) */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3.5 mb-3 relative z-10 shadow-xs">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium">
            {isComplete ? 'Status' : `Move Guidance (${scrambleProgressIndex + 1} of ${scrambleMoves.length})`}
          </div>

          {/* Auto-advance 2s status badge */}
          {isAutoAdvancing && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[var(--green)] bg-[var(--green)]/10 border border-[var(--green)]/30 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-ping" />
              <span>Auto 2s</span>
            </span>
          )}
        </div>

        {isComplete ? (
          <div className="flex items-center gap-2.5 text-[var(--green)] py-1">
            <CheckCircle2 className="w-6 h-6 shrink-0" />
            <div>
              <div className="font-heading font-semibold text-sm">Scramble Complete!</div>
              <div className="text-xs text-[var(--text-muted)]">Cube is in official WCA scrambled state</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="font-mono text-2xl font-bold text-[var(--white)] bg-[var(--surface-2)] border border-[var(--border)] px-3 py-1 rounded-xl shadow-xs shrink-0 min-w-[54px] text-center">
              {currentExpectedMove}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[var(--text)] truncate">
                {getMoveDescription(currentExpectedMove || '')}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Hold White on top (U), Green on front (F)
              </div>
            </div>
          </div>
        )}

        {/* Stepping & Auto-advance Toolbar */}
        <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-[var(--border)]/60">
          {!smartCube.isConnected ? (
            <button
              onClick={handleToggleAutoAdvance}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-heading font-medium transition-all cursor-pointer ${
                isAutoAdvancing
                  ? 'bg-[var(--green)] text-black font-semibold shadow-xs'
                  : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)]'
              }`}
              title={isAutoAdvancing ? 'Pause auto-advancing' : 'Auto-advance with 2s delay per move'}
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
          ) : (
            <div className="text-[11px] text-[var(--green)] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
              <span>Smart cube synced</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={() => {
                setIsAutoAdvancing(false);
                stepBackScrambleProgress();
              }}
              disabled={scrambleProgressIndex === 0}
              title="Previous move"
              className="p-2 rounded-xl bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <button
              onClick={() => {
                setIsAutoAdvancing(false);
                advanceScrambleProgress();
              }}
              disabled={isComplete}
              title="Next move"
              className="flex items-center gap-1 px-3 py-2 rounded-xl bg-[var(--white)] text-[var(--bg)] font-heading font-semibold text-xs hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer shadow-xs"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => {
                setIsAutoAdvancing(false);
                resetScrambleProgress();
              }}
              disabled={scrambleProgressIndex === 0}
              title="Reset scramble progress"
              className="p-2 rounded-xl bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              onClick={() => {
                setIsAutoAdvancing(false);
                completeScrambleProgress();
              }}
              disabled={isComplete}
              title="Skip to end / Mark fully scrambled"
              className="p-2 rounded-xl bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <CheckCheck className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Scramble Moves Ribbon (Interactive chips) */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3.5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium">
            WCA 3x3 Scramble Sequence
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">
            Tap any move to jump
          </span>
        </div>

        <div className="font-mono text-sm font-medium leading-relaxed tracking-wide flex flex-wrap gap-1.5 justify-center py-1">
          {scrambleMoves.map((m, idx) => {
            const isDone = idx < scrambleProgressIndex;
            const isCurrent = idx === scrambleProgressIndex;

            return (
              <button
                key={idx}
                onClick={() => {
                  setIsAutoAdvancing(false);
                  if (idx < scrambleProgressIndex) {
                    setScrambleProgressIndex(idx);
                  } else {
                    setScrambleProgressIndex(idx + 1);
                  }
                }}
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

        {smartCube.isConnected && (
          <div className="flex items-center justify-center gap-1.5 mt-2.5 pt-2 border-t border-[var(--border)]/50 text-xs text-[var(--green)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />
            <span>Smart cube connected · Matching physical turns auto-advance</span>
          </div>
        )}
      </div>

      {/* Bottom Action CTAs */}
      <div className="mt-auto flex flex-col gap-2.5 pt-2">
        <button
          onClick={() => {
            setIsAutoAdvancing(false);
            setMode('timed');
          }}
          className={`w-full py-3.5 rounded-xl font-heading font-semibold text-[15px] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm ${
            isComplete
              ? 'bg-[var(--white)] text-[var(--bg)] hover:opacity-90 ring-2 ring-[var(--green)]/50'
              : 'bg-[var(--white)] text-[var(--bg)] hover:opacity-90'
          }`}
        >
          <Play className="w-4 h-4 fill-current" />
          <span>Start Timed Solve</span>
        </button>

        <button
          onClick={() => {
            setIsAutoAdvancing(false);
            setMode('guided');
          }}
          className="w-full py-3 rounded-xl font-heading font-medium text-[14px] bg-transparent border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface)] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <Compass className="w-4 h-4" />
          <span>Launch Guided Walkthrough</span>
        </button>
      </div>
    </div>
  );
};


