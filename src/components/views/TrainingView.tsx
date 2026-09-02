import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, RotateCcw, ChevronLeft, ChevronRight, CheckCircle2, Eye, EyeOff, SkipForward, Lightbulb } from 'lucide-react';
import type { KPattern } from 'cubing/kpuzzle';
import { TwistyPlayerWrapper } from '../TwistyPlayerWrapper';
import { useAppStore } from '../../store/useAppStore';
import { useCubeStore } from '../../store/useCubeStore';
import { useSolverWorker } from '../../hooks/useSolverWorker';
import {
  getKPuzzle,
  getPostZ2Pattern,
  applyAlgToPattern,
  relabelMoveZ2,
  isPatternSolved,
} from '../../utils/kpuzzleHelper';
import { isOLLSolved, isFullySolved } from '../../solver/cfopInvariants';
import {
  buildTwoLookDrills,
  drillPredicate,
  solveWithAlgSet,
  type AlgOption,
  type ComboStep,
  type TwoLookDrillId,
} from '../../solver/twoLook';
import { saveTrainingRep } from '../../db/repository';
import type { TrainingPhase } from '../../types/db';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import algorithmData from '../../data/cfop-algorithms.json';

type RepStage = 'idle' | 'scramble' | 'attempt' | 'result';

interface ActiveRep {
  caseName: string;
  subset: string;
  algorithm: string;
  /** Setup scramble in the raw (white-up, smart-cube) frame — drives the connected guide. */
  scrambleRaw: string[];
  /** Same scramble in the post-z2 (yellow-up) frame — drives the no-cube 3D view + attempt. */
  scramblePostZ2: string[];
}

const SUB_MODES: { id: TrainingPhase; label: string; ready: boolean }[] = [
  { id: 'OLL', label: 'OLL', ready: true },
  { id: 'PLL', label: 'PLL', ready: true },
  { id: 'F2L', label: 'F2L', ready: false },
  { id: 'cross', label: 'Cross', ready: false },
];

const TWO_LOOK_DRILLS = buildTwoLookDrills(algorithmData as any);
const DRILLS_BY_SUBMODE: Record<'OLL' | 'PLL', TwoLookDrillId[]> = {
  OLL: ['oll-edges', 'oll-corners'],
  PLL: ['pll-corners', 'pll-edges'],
};

interface DrillConfig {
  isTwoLook: boolean;
  caseSource: 'OLL' | 'PLL' | 'OLL_2LOOK_EDGE';
  /** Every case this drill can present (for the include/exclude chips). */
  allCaseNames: string[];
  /** Cases actually in play after the allowlist. */
  poolCaseNames: string[];
  predicate: (p: KPattern) => boolean;
  /** Alg buttons for the attempt, or `null` to use the raw face keypad. */
  attemptAlgs: AlgOption[] | null;
  goalLabel: string;
}

export const TrainingView: React.FC = () => {
  const {
    trainingSubMode,
    trainingMethod,
    trainingCaseFilter,
    trainingCaseAllow,
    trainingStats,
    setTrainingSubMode,
    setTrainingMethod,
    setTrainingCaseFilter,
    setTrainingCaseAllow,
    recordTrainingAttempt,
    setTrackTarget,
    resetPhysicalTrack,
    trackRemainingMoves,
    trackDoneMoves,
    trackFeedback,
    currentProfileId,
  } = useAppStore();
  const { smartCube, visualAlg, physicalPattern } = useCubeStore();
  const { generateTrainingScramble, isReady } = useSolverWorker();
  const isDesktop = useIsDesktop();

  const connected = smartCube.isConnected;
  const phaseIsCaseBased = trainingSubMode === 'OLL' || trainingSubMode === 'PLL';

  // Full OLL/PLL case list (for the subset dropdown).
  const fullCaseList = useMemo(() => {
    if (!phaseIsCaseBased) return [];
    const entries = (algorithmData as unknown as Record<string, { name: string; subset?: string }[]>)[
      trainingSubMode
    ];
    return entries.map((e) => ({ name: e.name, subset: e.subset || trainingSubMode }));
  }, [phaseIsCaseBased, trainingSubMode]);

  const subsets = useMemo(() => Array.from(new Set(fullCaseList.map((c) => c.subset))).sort(), [fullCaseList]);

  const config: DrillConfig | null = useMemo(() => {
    if (!phaseIsCaseBased) return null;
    if (trainingMethod === 'full') {
      const names = (trainingCaseFilter ? fullCaseList.filter((c) => c.subset === trainingCaseFilter) : fullCaseList).map(
        (c) => c.name
      );
      return {
        isTwoLook: false,
        caseSource: trainingSubMode as 'OLL' | 'PLL',
        allCaseNames: fullCaseList.map((c) => c.name),
        poolCaseNames: names,
        predicate: trainingSubMode === 'OLL' ? isOLLSolved : isFullySolved,
        attemptAlgs: null,
        goalLabel: trainingSubMode === 'OLL' ? 'Orient the last layer' : 'Permute the last layer',
      };
    }
    const drill = TWO_LOOK_DRILLS[trainingMethod as TwoLookDrillId];
    if (!drill) return null;
    const pool = trainingCaseAllow ? drill.caseNames.filter((n) => trainingCaseAllow.includes(n)) : drill.caseNames;
    return {
      isTwoLook: true,
      caseSource: drill.caseSource,
      allCaseNames: drill.caseNames,
      poolCaseNames: pool.length > 0 ? pool : drill.caseNames,
      predicate: drillPredicate(drill.id),
      attemptAlgs: drill.algs,
      goalLabel: drill.goal,
    };
  }, [phaseIsCaseBased, trainingMethod, trainingSubMode, trainingCaseFilter, trainingCaseAllow, fullCaseList]);

  const [stage, setStage] = useState<RepStage>('idle');
  const [rep, setRep] = useState<ActiveRep | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAlg, setShowAlg] = useState(false);
  const [hint, setHint] = useState<ComboStep[] | 'none' | null>(null);

  const [stepIdx, setStepIdx] = useState(0);

  // Attempt: an ordered list of applied algs (single face turns, or full drill algs).
  const [attemptActions, setAttemptActions] = useState<string[]>([]);
  const attemptStartRef = useRef<number>(0);
  const moveHistoryBaselineRef = useRef<number>(0);
  const [result, setResult] = useState<{ solved: boolean; timeMs: number; moves: number } | null>(null);

  const attemptPattern = useMemo(() => {
    if (stage !== 'attempt' || !rep || connected) return null;
    return applyAlgToPattern(getPostZ2Pattern(), [...rep.scramblePostZ2, ...attemptActions].join(' '));
  }, [stage, rep, connected, attemptActions]);

  const attemptMoveCount = useMemo(
    () => attemptActions.join(' ').trim().split(/\s+/).filter(Boolean).length,
    [attemptActions]
  );

  const isPhysicalSolved = physicalPattern ? isPatternSolved(physicalPattern) : true;
  const awaitingSolved = connected && stage === 'scramble' && !isPhysicalSolved && trackDoneMoves.length === 0;
  const cubeHeight = isDesktop ? 360 : 210;

  useEffect(() => {
    getKPuzzle();
  }, []);

  // Reset any in-flight rep when the drill config changes.
  useEffect(() => {
    setStage('idle');
    setRep(null);
    setResult(null);
    setShowAlg(false);
    setHint(null);
    resetPhysicalTrack();
  }, [trainingSubMode, trainingMethod, resetPhysicalTrack]);

  const predicate = config?.predicate ?? isOLLSolved;

  const finishRep = useCallback(
    (solved: boolean, moves: string[]) => {
      const timeMs = Math.max(0, Math.round(performance.now() - attemptStartRef.current));
      setResult({ solved, timeMs, moves: moves.length });
      setStage('result');
      recordTrainingAttempt(solved);
      resetPhysicalTrack();
      if (rep) {
        void saveTrainingRep({
          profileId: currentProfileId,
          phase: trainingSubMode,
          method: trainingMethod,
          caseName: rep.caseName,
          moves,
          timeMs,
          success: solved,
          cubeConnected: connected,
        });
      }
    },
    [rep, currentProfileId, trainingSubMode, trainingMethod, connected, recordTrainingAttempt, resetPhysicalTrack]
  );

  const startRep = useCallback(async () => {
    if (!config || !isReady) return;
    setError(null);
    setIsGenerating(true);
    setResult(null);
    setShowAlg(false);
    setHint(null);
    try {
      const res = await generateTrainingScramble(config.caseSource, config.poolCaseNames);
      const scramblePostZ2 = res.moves;
      const scrambleRaw = scramblePostZ2.map(relabelMoveZ2);
      setRep({
        caseName: res.caseName,
        subset: res.subset,
        algorithm: res.algorithm || res.algorithmSimplified,
        scrambleRaw,
        scramblePostZ2,
      });
      setStepIdx(0);
      setAttemptActions([]);
      setTrackTarget(scrambleRaw);
      resetPhysicalTrack();
      setStage('scramble');
    } catch (err: any) {
      setError(err?.message || 'Failed to generate a training scramble');
    } finally {
      setIsGenerating(false);
    }
  }, [config, isReady, generateTrainingScramble, setTrackTarget, resetPhysicalTrack]);

  const enterAttempt = useCallback(() => {
    if (!rep) return;
    attemptStartRef.current = performance.now();
    setAttemptActions([]);
    setHint(null);
    if (connected) moveHistoryBaselineRef.current = useCubeStore.getState().moveHistory.length;
    setStage('attempt');
  }, [rep, connected]);

  // Connected: setup scramble complete -> start the attempt.
  useEffect(() => {
    if (stage === 'scramble' && connected && rep && trackDoneMoves.length > 0 && trackRemainingMoves.length === 0) {
      enterAttempt();
    }
  }, [stage, connected, rep, trackDoneMoves.length, trackRemainingMoves.length, enterAttempt]);

  // Connected: watch the physical cube during the attempt. `physicalPattern` is the raw
  // smart-cube frame; `· z2` brings it into the post-z2 frame the predicates expect.
  useEffect(() => {
    if (stage !== 'attempt' || !connected || !physicalPattern) return;
    if (predicate(applyAlgToPattern(physicalPattern, 'z2'))) {
      const moves = useCubeStore
        .getState()
        .moveHistory.slice(moveHistoryBaselineRef.current)
        .map((m) => m.move);
      finishRep(true, moves);
    }
  }, [stage, connected, physicalPattern, predicate, finishRep]);

  const applyAttemptAction = useCallback(
    (alg: string) => {
      if (stage !== 'attempt' || connected || !rep) return;
      const nextActions = [...attemptActions, alg];
      setHint(null);
      const next = applyAlgToPattern(getPostZ2Pattern(), [...rep.scramblePostZ2, ...nextActions].join(' '));
      setAttemptActions(nextActions);
      if (predicate(next)) {
        finishRep(true, nextActions.join(' ').trim().split(/\s+/).filter(Boolean));
      }
    },
    [stage, connected, rep, attemptActions, predicate, finishRep]
  );

  const undoAttemptAction = useCallback(() => {
    if (stage !== 'attempt' || connected || attemptActions.length === 0) return;
    setAttemptActions((a) => a.slice(0, -1));
    setHint(null);
  }, [stage, connected, attemptActions.length]);

  const showHint = useCallback(() => {
    if (!config?.attemptAlgs) return;
    const start = connected
      ? physicalPattern
        ? applyAlgToPattern(physicalPattern, 'z2')
        : null
      : attemptPattern;
    if (!start) return;
    const combo = solveWithAlgSet(start, config.attemptAlgs, config.predicate, 5);
    setHint(combo && combo.length ? combo : 'none');
  }, [config, connected, physicalPattern, attemptPattern]);

  // --- 3D view alg ---
  const { setupAlg, viewAlg } = useMemo(() => {
    if (connected) return { setupAlg: '', viewAlg: visualAlg };
    if (!rep) return { setupAlg: 'z2', viewAlg: '' };
    if (stage === 'scramble') return { setupAlg: 'z2', viewAlg: rep.scramblePostZ2.slice(0, stepIdx).join(' ') };
    return { setupAlg: 'z2', viewAlg: [...rep.scramblePostZ2, ...attemptActions].join(' ') };
  }, [connected, visualAlg, rep, stage, stepIdx, attemptActions]);

  const feedbackKind = trackFeedback?.kind ?? null;
  const scrambleGuideDone = !connected && rep ? stepIdx >= rep.scrambleRaw.length : false;
  const methodLabel =
    trainingMethod === 'full' ? 'Full' : TWO_LOOK_DRILLS[trainingMethod as TwoLookDrillId]?.label ?? trainingMethod;

  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-12 lg:gap-8 flex-1 pb-4">
      {/* Header */}
      <div className="lg:col-span-12 flex items-center justify-between mb-3">
        <div>
          <h1 className="font-heading font-semibold text-xl lg:text-2xl tracking-tight text-[var(--text)]">Training</h1>
          <div className="text-xs text-[var(--text-muted)] font-medium mt-0.5">
            {trainingSubMode}
            {phaseIsCaseBased && ` · ${methodLabel}`} · {connected ? 'smart cube' : 'on-screen'} input
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono text-[var(--text-muted)]">
          <span title="Solved / attempts this session">
            {trainingStats.solved}/{trainingStats.attempts}
          </span>
          {trainingStats.streak > 1 && <span className="text-[var(--green)]">🔥 {trainingStats.streak}</span>}
        </div>
      </div>

      {/* Sub-mode selector */}
      <div className="lg:col-span-12 flex items-center gap-1 bg-[var(--surface)] border border-[var(--border)] p-1 rounded-xl mb-2">
        {SUB_MODES.map((m) => (
          <button
            key={m.id}
            disabled={!m.ready}
            onClick={() => setTrainingSubMode(m.id)}
            className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-heading font-medium transition-all text-center ${
              trainingSubMode === m.id
                ? 'bg-[var(--white)] text-[var(--bg)] font-semibold shadow-xs'
                : m.ready
                ? 'text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer'
                : 'text-[var(--text-muted)]/40 cursor-not-allowed'
            }`}
          >
            {m.label}
            {!m.ready && <span className="ml-1 text-[9px]">soon</span>}
          </button>
        ))}
      </div>

      {/* Method selector (Full / 2-Look drills) */}
      {phaseIsCaseBased && (
        <div className="lg:col-span-12 flex items-center gap-1 bg-[var(--surface)] border border-[var(--border)] p-1 rounded-xl mb-3">
          <button
            onClick={() => setTrainingMethod('full')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-heading font-medium transition-all text-center cursor-pointer ${
              trainingMethod === 'full'
                ? 'bg-[var(--surface-2)] text-[var(--text)] font-semibold'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            Full {trainingSubMode}
          </button>
          {DRILLS_BY_SUBMODE[trainingSubMode as 'OLL' | 'PLL'].map((id) => (
            <button
              key={id}
              onClick={() => setTrainingMethod(id)}
              className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-heading font-medium transition-all text-center cursor-pointer ${
                trainingMethod === id
                  ? 'bg-[var(--surface-2)] text-[var(--text)] font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              2-Look: {TWO_LOOK_DRILLS[id].label}
            </button>
          ))}
        </div>
      )}

      {/* LEFT: 3D view */}
      <div className="lg:col-span-5 flex flex-col gap-3 mb-3 lg:mb-0">
        <div
          className={`bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 flex items-center justify-center min-h-[220px] lg:min-h-[400px] lg:flex-1 relative transition-shadow ${
            feedbackKind === 'error'
              ? 'ring-2 ring-[var(--red)]'
              : feedbackKind === 'partial'
              ? 'ring-2 ring-[var(--orange)]'
              : ''
          }`}
        >
          <TwistyPlayerWrapper setupAlg={setupAlg} alg={viewAlg} tempoScale={2.5} height={cubeHeight} />
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-[var(--surface-2)]/90 border border-[var(--border)] text-xs font-mono text-[var(--text-muted)]">
            {stage === 'idle' && 'Ready'}
            {stage === 'scramble' && 'Set up the case'}
            {stage === 'attempt' && (config?.goalLabel ?? 'Solve')}
            {stage === 'result' && (result?.solved ? 'Solved' : 'Skipped')}
          </div>
        </div>
        {connected && (
          <div className="hidden lg:flex items-center justify-center gap-2 p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--green)]">
            <span className="w-2 h-2 rounded-full bg-[var(--green)] animate-pulse" />
            <span>Smart cube connected · turns tracked</span>
          </div>
        )}
      </div>

      {/* RIGHT: controls */}
      <div className="lg:col-span-7 flex flex-col gap-3">
        {error && (
          <div className="text-xs text-[var(--red)] bg-[var(--red)]/10 border border-[var(--red)]/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* IDLE — case selection + start */}
        {stage === 'idle' && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3">
            {!phaseIsCaseBased ? (
              <p className="text-sm text-[var(--text-muted)]">{trainingSubMode} drills are coming in a later pass.</p>
            ) : config && !config.isTwoLook ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium">Case filter</span>
                <select
                  value={trainingCaseFilter ?? ''}
                  onChange={(e) => setTrainingCaseFilter(e.target.value || null)}
                  className="text-xs bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-[var(--text)] cursor-pointer"
                >
                  <option value="">All {fullCaseList.length} {trainingSubMode} cases</option>
                  {subsets.map((s) => (
                    <option key={s} value={s}>
                      {s} ({fullCaseList.filter((c) => c.subset === s).length})
                    </option>
                  ))}
                </select>
              </div>
            ) : config ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium">
                    Cases to drill
                  </span>
                  <button
                    onClick={() => setTrainingCaseAllow(null)}
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                  >
                    All
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {config.allCaseNames.map((name) => {
                    const on = !trainingCaseAllow || trainingCaseAllow.includes(name);
                    return (
                      <button
                        key={name}
                        onClick={() => {
                          const base = trainingCaseAllow ?? config.allCaseNames;
                          const next = on ? base.filter((n) => n !== name) : [...base, name];
                          setTrainingCaseAllow(next.length === config.allCaseNames.length ? null : next);
                        }}
                        className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                          on
                            ? 'bg-[var(--surface-2)] text-[var(--text)] ring-1 ring-[var(--border)]'
                            : 'bg-transparent text-[var(--text-muted)]/50 line-through'
                        }`}
                      >
                        {name.replace(/^OLL-\d+ /, '').replace(/ Perm$/, '')}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1 text-[11px] text-[var(--text-muted)]">
                  <span>Solve with:</span>
                  {config.attemptAlgs?.map((a) => (
                    <span key={a.label} className="font-mono text-[var(--text)]">
                      {a.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {phaseIsCaseBased && (
              <>
                <button
                  onClick={startRep}
                  disabled={isGenerating || !isReady}
                  className="w-full py-3 rounded-xl font-heading font-semibold text-sm bg-[var(--white)] text-[var(--bg)] hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                  <span>{isGenerating ? 'Generating…' : 'Start rep'}</span>
                </button>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                  A scramble sets up the case without giving away the solution.
                  {connected
                    ? ' Execute it on your cube, then solve — completion is detected automatically.'
                    : ' Step through it, then solve with the on-screen buttons.'}
                </p>
              </>
            )}
          </div>
        )}

        {/* SCRAMBLE — set up the case */}
        {stage === 'scramble' && rep && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium">
                Set up · {rep.caseName}
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">
                {connected ? 'physical turns drive this' : `${stepIdx} / ${rep.scrambleRaw.length}`}
              </span>
            </div>

            {awaitingSolved ? (
              <div className="text-xs text-[var(--yellow)] bg-[var(--yellow)]/10 border border-[var(--yellow)]/30 rounded-lg px-3 py-2">
                Return your cube to solved to begin — every turn from there is tracked.
              </div>
            ) : (
              <div className="font-mono text-sm flex flex-wrap gap-1.5 justify-center py-1">
                {connected ? (
                  <>
                    {trackDoneMoves.map((m, i) => (
                      <span key={`d${i}`} className="px-2 py-1 rounded-md text-xs opacity-40 line-through">
                        {m}
                      </span>
                    ))}
                    {trackRemainingMoves.map((m, i) => (
                      <span
                        key={`r${i}`}
                        className={`px-2 py-1 rounded-md text-xs ${
                          i === 0 && !feedbackKind
                            ? 'bg-[var(--white)] text-[var(--bg)] font-bold'
                            : feedbackKind && i < (trackFeedback?.corrections.length ?? 0)
                            ? 'bg-[var(--orange)]/15 text-[var(--orange)] font-bold'
                            : 'bg-[var(--surface-2)] text-[var(--text)]'
                        }`}
                      >
                        {m}
                      </span>
                    ))}
                  </>
                ) : (
                  rep.scrambleRaw.map((m, i) => (
                    <button
                      key={i}
                      onClick={() => setStepIdx(i < stepIdx ? i : i + 1)}
                      className={`px-2 py-1 rounded-md text-xs font-mono cursor-pointer transition-all ${
                        i < stepIdx
                          ? 'opacity-40 line-through'
                          : i === stepIdx
                          ? 'bg-[var(--white)] text-[var(--bg)] font-bold'
                          : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)]'
                      }`}
                    >
                      {m}
                    </button>
                  ))
                )}
              </div>
            )}

            {!connected && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
                  disabled={stepIdx === 0}
                  className="p-2 rounded-xl bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-30 transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setStepIdx((i) => Math.min(rep.scrambleRaw.length, i + 1))}
                  disabled={scrambleGuideDone}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-30 text-xs font-heading font-semibold transition-colors cursor-pointer"
                >
                  <span>Next move</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={enterAttempt}
                  disabled={!scrambleGuideDone}
                  className="flex-1 px-3 py-2 rounded-xl bg-[var(--white)] text-[var(--bg)] font-heading font-semibold text-xs hover:opacity-90 disabled:opacity-40 transition-all cursor-pointer"
                >
                  Start solving
                </button>
              </div>
            )}

            <button
              onClick={() => {
                resetPhysicalTrack();
                setStage('idle');
                setRep(null);
              }}
              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] self-start cursor-pointer"
            >
              Cancel rep
            </button>
          </div>
        )}

        {/* ATTEMPT — solve the case */}
        {stage === 'attempt' && rep && config && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium">
                {config.goalLabel} · recognise &amp; execute
              </span>
              <div className="flex items-center gap-3">
                {config.attemptAlgs ? (
                  <button
                    onClick={showHint}
                    className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                  >
                    <Lightbulb className="w-3.5 h-3.5" />
                    <span>Show me</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setShowAlg((s) => !s)}
                    className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                  >
                    {showAlg ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showAlg ? 'Hide' : 'Show'} algorithm</span>
                  </button>
                )}
              </div>
            </div>

            {showAlg && !config.attemptAlgs && (
              <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg py-2 px-3">
                <div className="font-mono text-sm text-center text-[var(--text)]">{rep.algorithm}</div>
                <div className="text-[10px] text-center text-[var(--text-muted)] mt-1">
                  align the top layer (U / U' / U2) to match, then execute
                </div>
              </div>
            )}

            {hint && (
              <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg py-2 px-3 text-center">
                {hint === 'none' ? (
                  <span className="text-[11px] text-[var(--text-muted)]">Already solved — nothing to do.</span>
                ) : (
                  <span className="font-mono text-sm text-[var(--text)]">
                    {hint.map((s) => s.label).join('  →  ')}
                  </span>
                )}
              </div>
            )}

            {connected ? (
              <div className="text-xs text-[var(--green)] bg-[var(--green)]/10 border border-[var(--green)]/30 rounded-lg px-3 py-2">
                Solve it on your cube — completion is detected automatically.
              </div>
            ) : (
              <>
                {config.attemptAlgs ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      {config.attemptAlgs.map((a) => (
                        <button
                          key={a.label}
                          onClick={() => applyAttemptAction(a.alg)}
                          className="py-2.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--border)] text-[var(--text)] font-heading font-semibold text-sm transition-colors cursor-pointer"
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {['U', "U'", 'U2'].map((u) => (
                        <button
                          key={u}
                          onClick={() => applyAttemptAction(u)}
                          className="py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--border)] text-[var(--text)] font-mono text-xs transition-colors cursor-pointer"
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {['U', 'R', 'F', 'D', 'L', 'B'].map((face) => (
                      <div key={face} className="flex gap-1">
                        {['', "'", '2'].map((mod) => (
                          <button
                            key={mod}
                            onClick={() => applyAttemptAction(face + mod)}
                            className="flex-1 py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--border)] text-[var(--text)] font-mono text-xs transition-colors cursor-pointer"
                          >
                            {face + mod}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-[var(--text-muted)] truncate">
                    {attemptMoveCount} moves · {attemptActions.join(' ')}
                  </span>
                  <button
                    onClick={undoAttemptAction}
                    disabled={attemptActions.length === 0}
                    className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-30 cursor-pointer shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Undo</span>
                  </button>
                </div>
              </>
            )}

            <button
              onClick={() =>
                finishRep(false, attemptActions.join(' ').trim().split(/\s+/).filter(Boolean))
              }
              className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] self-center cursor-pointer"
            >
              <SkipForward className="w-3.5 h-3.5" />
              <span>Skip this rep</span>
            </button>
          </div>
        )}

        {/* RESULT */}
        {stage === 'result' && rep && result && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              {result.solved ? (
                <CheckCircle2 className="w-6 h-6 text-[var(--green)] shrink-0" />
              ) : (
                <SkipForward className="w-6 h-6 text-[var(--text-muted)] shrink-0" />
              )}
              <div>
                <div className="font-heading font-semibold text-sm text-[var(--text)]">
                  {rep.caseName} {result.solved ? 'solved' : 'skipped'}
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {result.solved ? `${(result.timeMs / 1000).toFixed(2)}s · ${result.moves} moves` : 'No time recorded'}
                </div>
              </div>
            </div>

            <div className="font-mono text-xs text-center bg-[var(--surface-2)] border border-[var(--border)] rounded-lg py-2 px-3 text-[var(--text-muted)]">
              {rep.caseName}: {rep.algorithm}
            </div>

            <button
              onClick={startRep}
              disabled={isGenerating}
              className="w-full py-3 rounded-xl font-heading font-semibold text-sm bg-[var(--white)] text-[var(--bg)] hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
              <span>Next rep</span>
            </button>
            <button
              onClick={() => {
                setStage('idle');
                setRep(null);
                setResult(null);
              }}
              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] self-center cursor-pointer"
            >
              Change cases / drill
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
