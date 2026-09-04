import React, { useEffect, useState } from 'react';
import { RefreshCw, Play, Pause, Compass, ChevronLeft, ChevronRight, RotateCcw, CheckCheck, CheckCircle2 } from 'lucide-react';
import { TwistyPlayerWrapper } from '../TwistyPlayerWrapper';
import { useAppStore } from '../../store/useAppStore';
import { useCubeStore } from '../../store/useCubeStore';
import { useSolverWorker } from '../../hooks/useSolverWorker';
import { getMoveDescription } from '../../utils/constants';
import { isPatternSolved } from '../../utils/kpuzzleHelper';
import { useIsDesktop } from '../../hooks/useMediaQuery';

export const ScrambleView: React.FC = () => {
  const {
    currentScramble,
    scrambleMoves,
    scrambleProgressIndex,
    trackRemainingMoves,
    trackDoneMoves,
    trackFeedback,
    setScramble,
    setMode,
    setScrambleProgressIndex,
    advanceScrambleProgress,
    stepBackScrambleProgress,
    resetScrambleProgress,
    completeScrambleProgress,
    resetPhysicalTrack,
  } = useAppStore();

  const { smartCube, visualAlg, physicalPattern, setScramble: setCubeStoreScramble } = useCubeStore();
  const { generateScramble, isReady } = useSolverWorker();
  const isDesktop = useIsDesktop();
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

  // With a smart cube connected, every physical turn is tracked (utils/scrambleTracker.ts):
  // guidance runs off `trackRemainingMoves`, not the manual progress index.
  const connected = smartCube.isConnected;
  const physicalVisual = connected && visualAlg.length > 0;
  // The guided scramble only makes sense starting from a solved cube. If the connected
  // cube isn't solved yet (e.g. connected scrambled and routed through Timed, then
  // switched here), hold in "return to solved" until it is — physical turns are ignored
  // by the tracker until then (see useSmartCube.ts).
  const isPhysicalSolved = physicalPattern ? isPatternSolved(physicalPattern) : true;
  const awaitingSolved = connected && !isPhysicalSolved && trackDoneMoves.length === 0;
  const feedbackKind = trackFeedback?.kind ?? null;
  const correctionCount = trackFeedback?.corrections.length ?? 0;

  const isComplete = connected
    ? scrambleMoves.length > 0 && trackRemainingMoves.length === 0
    : scrambleMoves.length > 0 && scrambleProgressIndex >= scrambleMoves.length;

  const currentExpectedMove = connected
    ? trackRemainingMoves[0] ?? null
    : !isComplete && scrambleMoves.length > 0
    ? scrambleMoves[scrambleProgressIndex]
    : null;

  const doneCount = connected ? trackDoneMoves.length : scrambleProgressIndex;
  const totalCount = connected
    ? trackDoneMoves.length + trackRemainingMoves.length
    : scrambleMoves.length;

  // The 3D cube visualizer: mirror the real physical cube when connected, otherwise show
  // the progressive scramble algorithm up to scrambleProgressIndex.
  const currentProgressiveAlg = scrambleMoves.slice(0, scrambleProgressIndex).join(' ');
  const cubeAlg = physicalVisual ? visualAlg : currentProgressiveAlg;
  const cubeHeight = isDesktop ? 380 : 215;

  // The wrong-turn / half-done cue is NOT auto-faded: it mirrors live tracker state
  // (`trackRemainingMoves` still leads with the owed correction), so `applyPhysicalTrackMove`
  // is the only thing that clears it — the next progressing turn does, an off-path or
  // half turn replaces it, a rotation leaves it be. A timed fade used to desync the cue
  // from the tracker, so an owed undo would silently sit in the ribbon as a normal move.
  // (Matches TrainingView, which shares this tracker and never faded.)

  const handleToggleAutoAdvance = () => {
    if (isComplete) {
      resetScrambleProgress();
      setIsAutoAdvancing(true);
    } else {
      setIsAutoAdvancing((prev) => !prev);
    }
  };

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-12 lg:gap-8 flex-1 pb-4">
      {/* Mobile Header Bar */}
      <div className="flex lg:hidden items-center justify-between mb-1">
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

      <div className="flex lg:hidden text-xs text-[var(--text-muted)] mb-3 items-center justify-between">
        <span>Hold White on top (U), Green on front (F)</span>
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          {doneCount} / {totalCount}
        </span>
      </div>

      {/* LEFT COLUMN: Large 3D Visualizer Stage */}
      <div className="lg:col-span-5 xl:col-span-5 flex flex-col justify-between mb-3 lg:mb-0">
        <div
          className={`bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 flex flex-col items-center justify-center min-h-[225px] lg:min-h-[440px] lg:flex-1 relative transition-shadow duration-300 ${
            feedbackKind === 'error'
              ? 'ring-2 ring-[var(--red)] shadow-[0_0_0_4px_rgba(200,16,46,0.28)]'
              : feedbackKind === 'partial'
              ? 'ring-2 ring-[var(--orange)]'
              : ''
          }`}
        >
          {currentScramble ? (
            <TwistyPlayerWrapper
              setupAlg=""
              alg={cubeAlg}
              tempoScale={2}
              height={cubeHeight}
            />
          ) : (
            <div className="flex items-center justify-center text-sm text-[var(--text-muted)]">
              Generating WCA scramble…
            </div>
          )}

          {/* Floating Scramble Step Badge */}
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-[var(--surface-2)]/90 border border-[var(--border)] text-xs font-mono text-[var(--text-muted)] backdrop-blur-xs">
            {isComplete ? 'Scrambled' : `Step ${doneCount} of ${totalCount}`}
          </div>

          {/* Desktop Orientation Hint Overlay */}
          <div className="hidden lg:flex absolute bottom-3 inset-x-3 justify-center">
            <div className="px-3 py-1 rounded-lg bg-[var(--surface-2)]/80 border border-[var(--border)]/70 text-xs text-[var(--text-muted)] backdrop-blur-xs">
              Hold White on top (U), Green on front (F)
            </div>
          </div>
        </div>

        {connected && (
          <div className="hidden lg:flex items-center justify-center gap-2 mt-3 p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--green)]">
            <span className="w-2 h-2 rounded-full bg-[var(--green)] animate-pulse" />
            <span>Smart cube connected · Every turn tracked</span>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: Header, Guidance, Controls & Actions */}
      <div className="lg:col-span-7 xl:col-span-7 flex flex-col justify-between">
        {/* Desktop Header */}
        <div className="hidden lg:flex items-center justify-between mb-3 pb-2 border-b border-[var(--border)]/50">
          <div>
            <h1 className="font-heading font-semibold text-2xl tracking-tight text-[var(--text)]">
              Scramble Cube
            </h1>
            <div className="text-xs text-[var(--text-muted)] mt-0.5">
              Hold White on top (U), Green on front (F) · Step {doneCount} of {totalCount}
            </div>
          </div>
          <button
            onClick={fetchNewScramble}
            disabled={isGenerating}
            className="flex items-center gap-1.5 text-xs font-heading font-medium text-[var(--text)] bg-[var(--surface-2)] hover:bg-[var(--border)] border border-[var(--border)] rounded-xl px-3 py-2 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
            <span>New Scramble</span>
          </button>
        </div>

        {/* Next Move Callout Card & Controls */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3.5 lg:p-4 mb-3 relative z-10 shadow-xs">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium">
              {isComplete ? 'Status' : awaitingSolved ? 'Get Ready' : `Move Guidance (${doneCount + 1} of ${totalCount})`}
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
          ) : awaitingSolved ? (
            <div className="text-xs text-[var(--yellow)] bg-[var(--yellow)]/10 border border-[var(--yellow)]/30 rounded-lg px-3 py-2 leading-relaxed">
              Return your cube to the solved state to begin. Every turn from there is tracked
              move by move.
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div
                className={`font-mono text-2xl lg:text-3xl font-bold px-3 py-1.5 rounded-xl shadow-xs shrink-0 min-w-[58px] text-center border transition-colors ${
                  feedbackKind === 'error'
                    ? 'bg-[var(--red)]/15 text-[var(--red)] border-[var(--red)]/40'
                    : feedbackKind === 'partial'
                    ? 'bg-[var(--orange)]/15 text-[var(--orange)] border-[var(--orange)]/40'
                    : 'bg-[var(--surface-2)] text-[var(--white)] border-[var(--border)]'
                }`}
              >
                {currentExpectedMove}
              </div>
              <div className="min-w-0 flex-1">
                {feedbackKind === 'error' ? (
                  <div className="text-xs font-semibold text-[var(--red)]">
                    Wrong turn — do {trackFeedback?.corrections.join(' ')} to get back on track
                  </div>
                ) : feedbackKind === 'partial' ? (
                  <div className="text-xs font-semibold text-[var(--orange)]">
                    Half done — keep turning this face to {trackFeedback?.corrections.join(' ')}
                  </div>
                ) : (
                  <div className="text-xs lg:text-sm font-semibold text-[var(--text)] truncate">
                    {getMoveDescription(currentExpectedMove || '')}
                  </div>
                )}
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Hold White on top (U), Green on front (F)
                </div>
              </div>
            </div>
          )}

          {/* Stepping & Auto-advance Toolbar */}
          {connected ? (
            <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-[var(--border)]/60">
              <div className="text-[11px] text-[var(--green)] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
                <span>Smart cube · every turn tracked</span>
              </div>
              <button
                onClick={() => resetPhysicalTrack()}
                disabled={trackDoneMoves.length === 0}
                title="Restart scramble tracking (cube must be solved)"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-heading font-medium bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-[var(--border)]/60">
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
          )}
        </div>

        {/* Scramble Moves Ribbon */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3.5 lg:p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium">
              WCA 3x3 Scramble Sequence
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              {connected ? 'Physical turns drive this' : 'Tap any move to jump'}
            </span>
          </div>

          <div className="font-mono text-sm font-medium leading-relaxed tracking-wide flex flex-wrap gap-1.5 justify-center py-1">
            {connected ? (
              <>
                {trackDoneMoves.map((m, idx) => (
                  <span
                    key={`done-${idx}`}
                    className="px-2 py-1 rounded-md text-xs font-mono text-[var(--text-muted)] opacity-40 line-through"
                  >
                    {m}
                  </span>
                ))}
                {trackRemainingMoves.map((m, idx) => {
                  const isCorrection = feedbackKind !== null && idx < correctionCount;
                  const isNext = idx === 0 && !isCorrection;
                  return (
                    <span
                      key={`rem-${idx}`}
                      className={`px-2 py-1 rounded-md text-xs font-mono transition-colors ${
                        isCorrection && feedbackKind === 'error'
                          ? 'bg-[var(--red)]/15 text-[var(--red)] ring-1 ring-[var(--red)]/40 font-bold'
                          : isCorrection
                          ? 'bg-[var(--orange)]/15 text-[var(--orange)] ring-1 ring-[var(--orange)]/40 font-bold'
                          : isNext
                          ? 'bg-[var(--white)] text-[var(--bg)] font-bold shadow-xs scale-105 ring-2 ring-[var(--white)]/30'
                          : 'text-[var(--text)] bg-[var(--surface-2)]'
                      }`}
                    >
                      {m}
                    </span>
                  );
                })}
              </>
            ) : (
              scrambleMoves.map((m, idx) => {
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
              })
            )}
          </div>

          {connected && (
            <div className="flex items-center justify-center gap-1.5 mt-2.5 pt-2 border-t border-[var(--border)]/50 text-xs text-[var(--green)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />
              <span>Smart cube connected · mistakes corrected inline</span>
            </div>
          )}
        </div>

        {/* Bottom Action CTAs */}
        <div className="mt-auto flex flex-col sm:flex-row gap-2.5 pt-2">
          <button
            onClick={() => {
              setIsAutoAdvancing(false);
              setMode('timed');
            }}
            className={`flex-1 py-3.5 rounded-xl font-heading font-semibold text-[15px] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm ${
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
            className="flex-1 py-3 rounded-xl font-heading font-medium text-[14px] bg-transparent border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface)] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Compass className="w-4 h-4" />
            <span>Launch Guided Walkthrough</span>
          </button>
        </div>
      </div>
    </div>
  );
};


