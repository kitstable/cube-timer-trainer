/**
 * Guided-scramble move tracker (pure).
 *
 * The scramble guide walks the user through `scrambleMoves` one turn at a time while a
 * smart cube is connected. Every physical turn is fed here — not just the "expected" one.
 *
 * Model: the target state is `solved · scrambleMoves`. After the user's committed moves
 * `done`, the shortest remaining alg `R` satisfies `physical · R = target`, i.e.
 * `R = done⁻¹ · scrambleMoves`. We recompute `R` from the full history on every turn
 * (~20-25 tokens — trivially cheap, and it avoids locking in a bad single-pass
 * simplification that an incremental form would accumulate).
 *
 * A wrong turn prepends correction move(s) to `R` (scramble `L' D F2`, user does `R` →
 * `R' L' D F2`); a same-face wrong-direction turn is a "partial", not an error
 * (expected `L2`, user does `L'` → head becomes `L'`, finish it with another `L'`).
 *
 * Everything here is string algebra in the raw move-letter frame — no `KPattern`, no
 * solver, so none of the z2 / relabel gotchas in CLAUDE.md apply.
 */

import {
  simplifyMoveSequence,
  invertMove,
  isSimpleFaceMove,
  moveFace,
  oppositeFace,
} from './moveSimplifier';
import type { ScrambleFeedback } from '../types/cube';

export type ScrambleMoveKind =
  | 'progress' // on the guided path (or advanced along it)
  | 'partial' // wrong direction on the right face — keep turning it, not an error
  | 'error' // turned a face off the path — correction move(s) now owed
  | 'complete' // scramble finished
  | 'ignored'; // rotation / wide / slice — not tracked by the guide

export interface ScrambleClassification {
  kind: ScrambleMoveKind;
  /** Remaining alg from the (new) physical state to the scramble target. */
  nextRemaining: string[];
  /** Committed physical face-turns after this move (unchanged for `ignored`). */
  nextDone: string[];
  /** Leading tokens of `nextRemaining` that are corrections, not scramble moves. */
  corrections: string[];
  /** Whether a correction is still owed after this move. */
  correctionActive: boolean;
}

/** Shortest remaining alg from the state after `doneMoves` to `solved · scrambleMoves`. */
export function remainingFor(scrambleMoves: string[], doneMoves: string[]): string[] {
  return simplifyMoveSequence([
    ...doneMoves.map(invertMove).reverse(),
    ...scrambleMoves,
  ]);
}

/** Length of the longest common suffix of `a` and `b`. */
function commonSuffixLen(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length);
  let k = 0;
  while (k < max && a[a.length - 1 - k] === b[b.length - 1 - k]) k++;
  return k;
}

/** The correction prefix of `remaining` — the part that isn't a tail of the scramble. */
function correctionHead(remaining: string[], scrambleMoves: string[]): string[] {
  const suffixLen = commonSuffixLen(remaining, scrambleMoves);
  return remaining.slice(0, remaining.length - suffixLen);
}

/**
 * Classify one physical turn against the scramble.
 *
 * @param correctionActive whether a correction was already owed before this move —
 *   keeps a compounded/repeated wrong turn classified `error` instead of flipping to
 *   `partial`.
 */
export function classifyScrambleMove(
  scrambleMoves: string[],
  doneMoves: string[],
  move: string,
  correctionActive: boolean,
): ScrambleClassification {
  // Rotations / wide moves / slices: useCubeStore still animates them, but they'd act as
  // opaque barriers in the simplifier and would never let `nextRemaining` reach empty.
  if (!isSimpleFaceMove(move)) {
    const remaining = remainingFor(scrambleMoves, doneMoves);
    return {
      kind: 'ignored',
      nextRemaining: remaining,
      nextDone: doneMoves,
      corrections: correctionActive ? correctionHead(remaining, scrambleMoves) : [],
      correctionActive,
    };
  }

  // `prevRemaining` is "what's needed from here" — it already folds in any owed correction,
  // since it's derived the same way `nextRemaining` is. Classification is judged only against
  // its front: is this move on the immediate pivot's face, or (the one bounded reorder case)
  // the face of the token right after it, when those two commute? Reasoning locally like this
  // (rather than scanning `nextRemaining` for a literal-token match anywhere in the *original*
  // `scrambleMoves` array) is what keeps a repeated face+direction elsewhere in the sequence
  // from spuriously matching the wrong occurrence — see the tracker's test suite for the
  // concrete repros this fixes.
  const prevRemaining = remainingFor(scrambleMoves, doneMoves);
  const nextDone = [...doneMoves, move];
  const nextRemaining = remainingFor(scrambleMoves, nextDone);

  if (nextRemaining.length === 0) {
    return { kind: 'complete', nextRemaining, nextDone, corrections: [], correctionActive: false };
  }

  const pivotFace = prevRemaining.length > 0 ? moveFace(prevRemaining[0]) : null;
  const secondFace = prevRemaining.length > 1 ? moveFace(prevRemaining[1]) : null;
  const movedFace = moveFace(move);

  const onPivotFace = pivotFace !== null && movedFace === pivotFace;
  // The one bounded reorder tolerance: the adjacent commuting pair played out of order
  // (`R L` done as `L R`) — never an unbounded scan of the rest of the sequence.
  const onCommutingSecondFace =
    !onPivotFace &&
    pivotFace !== null &&
    secondFace !== null &&
    movedFace === secondFace &&
    oppositeFace(pivotFace) === secondFace;

  // Does the face just turned still have a residual amount owed at the front of what's left?
  // (E.g. the first quarter of a double: `nextRemaining[0]` is still on that same face.)
  const residualSameFace = movedFace !== null && moveFace(nextRemaining[0]) === movedFace;

  if (onPivotFace && !correctionActive) {
    return residualSameFace
      ? { kind: 'partial', nextRemaining, nextDone, corrections: [nextRemaining[0]], correctionActive: false }
      : { kind: 'progress', nextRemaining, nextDone, corrections: [], correctionActive: false };
  }

  if (onCommutingSecondFace) {
    const kind: ScrambleMoveKind = residualSameFace ? 'partial' : 'progress';
    if (!correctionActive) {
      return { kind, nextRemaining, nextDone, corrections: [], correctionActive: false };
    }
    const corrections = correctionHead(nextRemaining, scrambleMoves);
    return { kind, nextRemaining, nextDone, corrections, correctionActive: corrections.length > 0 };
  }

  // Off the immediate path entirely, or re-turning an already-owed pivot face while a
  // correction is active — a fresh/compounded mistake, unless this exact turn objectively
  // shrinks the true remaining distance (undoing/discharging the owed correction).
  const corrections = correctionHead(nextRemaining, scrambleMoves);
  const shrank = nextRemaining.length < prevRemaining.length;
  const kind: ScrambleMoveKind = onPivotFace && shrank ? 'progress' : 'error';

  return {
    kind,
    nextRemaining,
    nextDone,
    corrections,
    correctionActive: kind !== 'progress' || corrections.length > 0,
  };
}

/**
 * The wrong-turn / half-turn cue to display for a classified turn.
 *
 * The cue tracks *whether a correction is still owed*, not just the `kind` of the single
 * turn that produced this classification. So after two wrong turns, doing one correcting
 * turn (which classifies `progress` because it shrank the correction burden) still keeps
 * the red cue up — with the *remaining* owed moves — until the guide is fully back on the
 * path. Without this, a half-fixed mistake left the owed undo sitting unstyled in the
 * ribbon with no explanation ("errors silently handled").
 *
 * `partial` (a same-face wrong-direction turn) always shows its amber "keep turning" cue.
 */
export function feedbackForClassification(cls: ScrambleClassification): ScrambleFeedback | null {
  if (cls.kind === 'partial') return { kind: 'partial', corrections: cls.corrections };
  if (cls.correctionActive && cls.corrections.length > 0) {
    return { kind: 'error', corrections: cls.corrections };
  }
  return null;
}
