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
  getDefaultPattern,
  applyAlgToPattern,
  relabelMoveZ2,
  isPatternSolved,
  toZ2DisplayAlg,
  isAllFaceTurns,
} from '../../utils/kpuzzleHelper';
import {
  isOLLSolved,
  isFullySolved,
  isCrossSolved,
  isSlotSolved,
  preservesProgress,
  type F2LSlot,
} from '../../solver/cfopInvariants';
import {
  buildTwoLookDrills,
  drillPredicate,
  solveWithAlgSet,
  type AlgOption,
  type ComboStep,
  type TwoLookDrillId,
} from '../../solver/twoLook';
import {
  trackFeedbackPanelClass,
  trackFeedbackChipClass,
  TrackFeedbackMessage,
} from '../ui/TrackFeedback';
import { saveTrainingRep } from '../../db/repository';
import type { TrainingPhase } from '../../types/db';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import algorithmData from '../../data/cfop-algorithms.json';

type RepStage = 'idle' | 'scramble' | 'attempt' | 'result';

/** 'postZ2' = yellow-up view (LL drills); 'raw' = white-up view (cross). */
type Frame = 'postZ2' | 'raw';

interface ActiveRep {
  caseName: string;
  subset: string;
  algorithm: string;
  frame: Frame;
  /** F2L slot being drilled this rep (F2L only). */
  f2lSlot?: F2LSlot;
  /** Setup scramble in the raw (white-up, smart-cube) frame — drives the connected guide. */
  scrambleRaw: string[];
  /** Setup scramble in the rep's own view frame — drives the no-cube ribbon + 3D + attempt. */
  scrambleView: string[];
}

const SUB_MODES: { id: TrainingPhase; label: string; ready: boolean }[] = [
  { id: 'OLL', label: 'OLL', ready: true },
  { id: 'PLL', label: 'PLL', ready: true },
  { id: 'F2L', label: 'F2L', ready: true },
  { id: 'cross', label: 'Cross', ready: true },
];

const F2L_SLOTS: F2LSlot[] = ['FR', 'FL', 'BR', 'BL'];

const TWO_LOOK_DRILLS = buildTwoLookDrills(algorithmData as any);
const DRILLS_BY_SUBMODE: Record<'OLL' | 'PLL', TwoLookDrillId[]> = {
  OLL: ['oll-edges', 'oll-corners'],
  PLL: ['pll-corners', 'pll-edges'],
};

type Kind = 'full' | 'twolook' | 'f2l' | 'cross';

interface DrillConfig {
  kind: Kind;
  frame: Frame;
  /** How the setup scramble is generated: a worker case source, or a random WCA scramble. */
  caseSource: 'OLL' | 'PLL' | 'OLL_2LOOK_EDGE' | 'F2L' | 'wca';
  /** Every case this drill can present (for the include/exclude chips). Empty for cross. */
  allCaseNames: string[];
  /** Cases actually in play after the allowlist. Empty for cross. */
  poolCaseNames: string[];
  /** `start` is the post-z2 pattern at the moment the attempt began (for F2L progress checks). */
  predicate: (p: KPattern, start: KPattern) => boolean;
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
    trainingF2lSlot,
    trainingStats,
    setTrainingSubMode,
    setTrainingMethod,
    setTrainingCaseFilter,
    setTrainingCaseAllow,
    setTrainingF2lSlot,
    recordTrainingAttempt,
    setTrackTarget,
    resetPhysicalTrack,
    trackRemainingMoves,
    trackDoneMoves,
    trackFeedback,
    currentProfileId,
    connectedYellowUp,
  } = useAppStore();
  const { smartCube, visualAlg, physicalPattern } = useCubeStore();
  const { generateTrainingScramble, generateScramble, solveCross, findHint, isReady } = useSolverWorker();
  const isDesktop = useIsDesktop();

  const connected = smartCube.isConnected;
  const phaseIsCaseBased = trainingSubMode === 'OLL' || trainingSubMode === 'PLL';

  // Case list for the active phase's subset dropdown (OLL / PLL / F2L).
  const fullCaseList = useMemo(() => {
    const key = trainingSubMode === 'F2L' ? 'F2L' : phaseIsCaseBased ? trainingSubMode : null;
    if (!key) return [];
    const entries = (algorithmData as unknown as Record<string, { name: string; subset?: string }[]>)[key];
    return entries.map((e) => ({ name: e.name, subset: e.subset || key }));
  }, [phaseIsCaseBased, trainingSubMode]);

  const subsets = useMemo(() => Array.from(new Set(fullCaseList.map((c) => c.subset))).sort(), [fullCaseList]);

  const f2lSlotOf = (name: string): F2LSlot =>
    name.includes('Front Left') ? 'FL' : name.includes('Back Right') ? 'BR' : name.includes('Back Left') ? 'BL' : 'FR';

  const config: DrillConfig | null = useMemo(() => {
    if (trainingSubMode === 'cross') {
      return {
        kind: 'cross',
        frame: 'raw',
        caseSource: 'wca',
        allCaseNames: [],
        poolCaseNames: [],
        predicate: (p) => isCrossSolved(p),
        attemptAlgs: null,
        goalLabel: 'Solve the cross',
      };
    }
    if (trainingSubMode === 'F2L') {
      const bySlot =
        trainingF2lSlot === 'random'
          ? fullCaseList
          : fullCaseList.filter((c) => f2lSlotOf(c.name) === trainingF2lSlot);
      const bySubset = trainingCaseFilter ? bySlot.filter((c) => c.subset === trainingCaseFilter) : bySlot;
      return {
        kind: 'f2l',
        frame: 'postZ2',
        caseSource: 'F2L',
        allCaseNames: fullCaseList.map((c) => c.name),
        poolCaseNames: bySubset.map((c) => c.name),
        // Real check needs the rep's slot — see `predicate` below.
        predicate: () => false,
        attemptAlgs: null,
        goalLabel: 'Solve the F2L pair',
      };
    }
    if (!phaseIsCaseBased) return null;
    if (trainingMethod === 'full') {
      const names = (trainingCaseFilter ? fullCaseList.filter((c) => c.subset === trainingCaseFilter) : fullCaseList).map(
        (c) => c.name
      );
      return {
        kind: 'full',
        frame: 'postZ2',
        caseSource: trainingSubMode as 'OLL' | 'PLL',
        allCaseNames: fullCaseList.map((c) => c.name),
        poolCaseNames: names,
        predicate: trainingSubMode === 'OLL' ? (p) => isOLLSolved(p) : (p) => isFullySolved(p),
        attemptAlgs: null,
        goalLabel: trainingSubMode === 'OLL' ? 'Orient the last layer' : 'Permute the last layer',
      };
    }
    const drill = TWO_LOOK_DRILLS[trainingMethod as TwoLookDrillId];
    if (!drill) return null;
    const pool = trainingCaseAllow ? drill.caseNames.filter((n) => trainingCaseAllow.includes(n)) : drill.caseNames;
    const pred = drillPredicate(drill.id);
    return {
      kind: 'twolook',
      frame: 'postZ2',
      caseSource: drill.caseSource,
      allCaseNames: drill.caseNames,
      poolCaseNames: pool.length > 0 ? pool : drill.caseNames,
      predicate: (p) => pred(p),
      attemptAlgs: drill.algs,
      goalLabel: drill.goal,
    };
  }, [phaseIsCaseBased, trainingMethod, trainingSubMode, trainingCaseFilter, trainingCaseAllow, trainingF2lSlot, fullCaseList]);

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

  /** Solved seed for the rep's view frame ('raw' = white-up default, 'postZ2' = yellow-up). */
  const viewSeed = useCallback(
    (frame: Frame) => (frame === 'raw' ? getDefaultPattern() : getPostZ2Pattern()),
    []
  );
  const toPostZ2 = useCallback(
    (p: KPattern, frame: Frame) => (frame === 'raw' ? applyAlgToPattern(p, 'z2') : p),
    []
  );

  // No-cube attempt state, in the rep's view frame.
  const attemptPattern = useMemo(() => {
    if (stage !== 'attempt' || !rep || connected) return null;
    return applyAlgToPattern(viewSeed(rep.frame), [...rep.scrambleView, ...attemptActions].join(' '));
  }, [stage, rep, connected, attemptActions, viewSeed]);

  /** Post-z2 pattern at the moment the attempt began — F2L `preservesProgress` needs it. */
  const attemptStartPostZ2Ref = useRef<KPattern | null>(null);

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
  }, [trainingSubMode, trainingMethod, trainingF2lSlot, resetPhysicalTrack]);

  /** The completion check for the current rep, taking a post-z2 pattern + the attempt-start pattern. */
  const predicate = useCallback(
    (pPostZ2: KPattern, startPostZ2: KPattern): boolean => {
      if (config?.kind === 'f2l' && rep?.f2lSlot) {
        return isSlotSolved(pPostZ2, rep.f2lSlot) && preservesProgress(startPostZ2, pPostZ2);
      }
      return config ? config.predicate(pPostZ2, startPostZ2) : isOLLSolved(pPostZ2);
    },
    [config, rep]
  );

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
          method:
            trainingSubMode === 'F2L' ? `slot:${rep.f2lSlot}` : trainingSubMode === 'cross' ? 'full' : trainingMethod,
          caseName: rep.caseName,
          slot: rep.f2lSlot,
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
      let next: ActiveRep;
      if (config.kind === 'cross') {
        const s = await generateScramble();
        next = {
          caseName: 'Cross',
          subset: 'Cross',
          algorithm: '',
          frame: 'raw',
          scrambleRaw: s.moves,
          scrambleView: s.moves,
        };
      } else {
        const res = await generateTrainingScramble(
          config.caseSource as 'OLL' | 'PLL' | 'F2L' | 'OLL_2LOOK_EDGE',
          config.poolCaseNames
        );
        const scrambleView = res.moves; // post-z2 (matcher frame)
        next = {
          caseName: res.caseName,
          subset: res.subset,
          algorithm: res.algorithm || res.algorithmSimplified,
          frame: 'postZ2',
          f2lSlot: config.kind === 'f2l' ? f2lSlotOf(res.caseName) : undefined,
          scrambleRaw: scrambleView.map(relabelMoveZ2),
          scrambleView,
        };
      }
      setRep(next);
      setStepIdx(0);
      setAttemptActions([]);
      setTrackTarget(next.scrambleRaw);
      resetPhysicalTrack();
      setStage('scramble');
    } catch (err: any) {
      setError(err?.message || 'Failed to generate a training scramble');
    } finally {
      setIsGenerating(false);
    }
  }, [config, isReady, generateTrainingScramble, generateScramble, setTrackTarget, resetPhysicalTrack]);

  const enterAttempt = useCallback(() => {
    if (!rep) return;
    attemptStartRef.current = performance.now();
    setAttemptActions([]);
    setHint(null);
    if (connected) {
      moveHistoryBaselineRef.current = useCubeStore.getState().moveHistory.length;
      attemptStartPostZ2Ref.current = physicalPattern ? applyAlgToPattern(physicalPattern, 'z2') : null;
    } else {
      attemptStartPostZ2Ref.current = toPostZ2(
        applyAlgToPattern(viewSeed(rep.frame), rep.scrambleView.join(' ')),
        rep.frame
      );
    }
    setStage('attempt');
  }, [rep, connected, physicalPattern, viewSeed, toPostZ2]);

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
    const start = attemptStartPostZ2Ref.current;
    if (start && predicate(applyAlgToPattern(physicalPattern, 'z2'), start)) {
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
      const nextView = applyAlgToPattern(viewSeed(rep.frame), [...rep.scrambleView, ...nextActions].join(' '));
      const start = attemptStartPostZ2Ref.current;
      setAttemptActions(nextActions);
      if (start && predicate(toPostZ2(nextView, rep.frame), start)) {
        finishRep(true, nextActions.join(' ').trim().split(/\s+/).filter(Boolean));
      }
    },
    [stage, connected, rep, attemptActions, predicate, finishRep, viewSeed, toPostZ2]
  );

  const undoAttemptAction = useCallback(() => {
    if (stage !== 'attempt' || connected || attemptActions.length === 0) return;
    setAttemptActions((a) => a.slice(0, -1));
    setHint(null);
  }, [stage, connected, attemptActions.length]);

  /** Current attempt state in the post-z2 frame (no-cube), or null when connected/not attempting. */
  const currentPostZ2 = useMemo(() => {
    if (connected) return physicalPattern ? applyAlgToPattern(physicalPattern, 'z2') : null;
    if (!rep || !attemptPattern) return null;
    return toPostZ2(attemptPattern, rep.frame);
  }, [connected, physicalPattern, rep, attemptPattern, toPostZ2]);

  const showHint = useCallback(async () => {
    if (!config || !rep) return;
    const src = connected
      ? physicalPattern
        ? applyAlgToPattern(physicalPattern, 'z2')
        : null
      : currentPostZ2 ?? attemptStartPostZ2Ref.current;
    if (config.kind === 'cross') {
      if (!src) return;
      try {
        const res = await solveCross(src.patternData);
        const moves = (res.moves ?? []).map(relabelMoveZ2); // post-z2 -> white-up raw
        setHint(moves.length ? [{ label: moves.join(' '), alg: '' }] : 'none');
      } catch {
        setHint('none');
      }
      return;
    }
    if (config.kind === 'f2l') {
      if (!src || !rep.f2lSlot) return;
      try {
        const res = await findHint('f2l-1', src.patternData, rep.f2lSlot, '2look', 'simplified');
        const moves: string[] = res?.moves ?? [];
        setHint(moves.length ? [{ label: moves.join(' '), alg: '' }] : 'none');
      } catch {
        setHint('none');
      }
      return;
    }
    if (!config.attemptAlgs || !currentPostZ2) return;
    const combo = solveWithAlgSet(currentPostZ2, config.attemptAlgs, (p) => predicate(p, currentPostZ2), 5);
    setHint(combo && combo.length ? combo : 'none');
  }, [config, rep, connected, physicalPattern, solveCross, findHint, currentPostZ2, predicate]);

  // --- 3D view alg ---
  const { setupAlg, viewAlg } = useMemo(() => {
    // Connected: default is to mirror the cube exactly as its sensor reports it (raw `visualAlg`).
    // With `connectedYellowUp` on, render yellow-face-up (`z2` setup + `toZ2DisplayAlg(visualAlg)`)
    // — except the Cross drill (`frame: 'raw'`), which stays white-up so the cross forms on top,
    // and except when `visualAlg` isn't all face turns (a reconstructed rotated frame — fall back
    // to raw rather than mis-relabel a rotation token).
    // No-cube: OLL/PLL/F2L reps render last-layer-up (`z2` setup + post-z2 move stream from the
    // matcher); the Cross drill renders white-up. Untouched.
    if (connected) {
      const rawFrame = (rep?.frame ?? config?.frame) === 'raw';
      const yellowUp = connectedYellowUp && !rawFrame && isAllFaceTurns(visualAlg);
      return yellowUp
        ? { setupAlg: 'z2', viewAlg: toZ2DisplayAlg(visualAlg) }
        : { setupAlg: '', viewAlg: visualAlg };
    }
    const su = rep?.frame === 'raw' ? '' : 'z2';
    if (!rep) return { setupAlg: 'z2', viewAlg: '' };
    if (stage === 'scramble') return { setupAlg: su, viewAlg: rep.scrambleView.slice(0, stepIdx).join(' ') };
    return { setupAlg: su, viewAlg: [...rep.scrambleView, ...attemptActions].join(' ') };
  }, [connected, visualAlg, rep, config?.frame, connectedYellowUp, stage, stepIdx, attemptActions]);

  const feedbackKind = trackFeedback?.kind ?? null;
  // Connected setup-scramble ribbon: the physical tracker (`useSmartCube` → `trackTargetMoves`)
  // stays in the raw white-up frame, but with the yellow-up 3D view on the *displayed* setup
  // moves must match it — relabel them for render only (`relabelMoveZ2` is its own inverse for
  // face turns, so a physical raw turn still matches the raw target). Cross drill stays white-up.
  const yellowUpTrackDisplay =
    connected && connectedYellowUp && (rep?.frame ?? config?.frame) !== 'raw';
  const dispTrackMove = (m: string) => (yellowUpTrackDisplay ? relabelMoveZ2(m) : m);
  const scrambleGuideDone = !connected && rep ? stepIdx >= rep.scrambleView.length : false;
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
          className={`bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 flex items-center justify-center min-h-[220px] lg:min-h-[400px] lg:flex-1 relative transition-shadow duration-300 ${trackFeedbackPanelClass(
            feedbackKind
          )}`}
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
        {stage === 'idle' && config && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3">
            {config.kind === 'cross' ? (
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                A full random scramble. Plan your cross{connected ? '' : ', step through the scramble'}, then solve just
                the four white edges — completion is detected automatically.
              </p>
            ) : config.kind === 'f2l' ? (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium">Slot</span>
                  <div className="flex gap-1">
                    {(['random', ...F2L_SLOTS] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setTrainingF2lSlot(s)}
                        className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                          trainingF2lSlot === s
                            ? 'bg-[var(--surface-2)] text-[var(--text)] ring-1 ring-[var(--border)]'
                            : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                        }`}
                      >
                        {s === 'random' ? 'Any' : s}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium">Case type</span>
                  <select
                    value={trainingCaseFilter ?? ''}
                    onChange={(e) => setTrainingCaseFilter(e.target.value || null)}
                    className="text-xs bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-[var(--text)] cursor-pointer"
                  >
                    <option value="">All case types</option>
                    {subsets.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                  Attempt-first: no algorithm shown. Solve the pair any way you like — the slot just has to end solved
                  without disturbing the rest.
                </p>
              </div>
            ) : config.kind === 'full' ? (
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
            ) : (
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
            )}

            <button
              onClick={startRep}
              disabled={isGenerating || !isReady}
              className="w-full py-3 rounded-xl font-heading font-semibold text-sm bg-[var(--white)] text-[var(--bg)] hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
              <span>{isGenerating ? 'Generating…' : 'Start rep'}</span>
            </button>
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
                {connected ? 'physical turns drive this' : `${stepIdx} / ${rep.scrambleView.length}`}
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
                        {dispTrackMove(m)}
                      </span>
                    ))}
                    {trackRemainingMoves.map((m, i) => {
                      const isCorrection = !!feedbackKind && i < (trackFeedback?.corrections.length ?? 0);
                      return (
                        <span
                          key={`r${i}`}
                          className={`px-2 py-1 rounded-md text-xs ${
                            isCorrection
                              ? trackFeedbackChipClass(feedbackKind)
                              : i === 0 && !feedbackKind
                              ? 'bg-[var(--white)] text-[var(--bg)] font-bold'
                              : 'bg-[var(--surface-2)] text-[var(--text)]'
                          }`}
                        >
                          {dispTrackMove(m)}
                        </span>
                      );
                    })}
                  </>
                ) : (
                  rep.scrambleView.map((m, i) => (
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

            {connected && trackFeedback && (
              <div className="text-center">
                {/* The tracker + `trackFeedback.corrections` live in the raw white-up frame;
                    with the yellow-up 3D view on, the ribbon relabels each token for display
                    (`dispTrackMove`) — the message has to match it. */}
                <TrackFeedbackMessage
                  feedback={
                    yellowUpTrackDisplay
                      ? { ...trackFeedback, corrections: trackFeedback.corrections.map(dispTrackMove) }
                      : trackFeedback
                  }
                />
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
                  onClick={() => setStepIdx((i) => Math.min(rep.scrambleView.length, i + 1))}
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
                {config.kind === 'full' ? (
                  <button
                    onClick={() => setShowAlg((s) => !s)}
                    className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                  >
                    {showAlg ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showAlg ? 'Hide' : 'Show'} algorithm</span>
                  </button>
                ) : (
                  <button
                    onClick={showHint}
                    className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                  >
                    <Lightbulb className="w-3.5 h-3.5" />
                    <span>
                      {config.kind === 'cross' ? 'Show cross' : config.kind === 'f2l' ? 'Show solution' : 'Show me'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {showAlg && config.kind === 'full' && (
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
