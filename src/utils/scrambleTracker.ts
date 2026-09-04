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
  sameFace,
  isSimpleFaceMove,
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

/** True when `sub` appears in `seq` in order, allowing skipped elements. */
function isSubsequence(sub: string[], seq: string[]): boolean {
  let i = 0;
  for (const s of seq) {
    if (i < sub.length && sub[i] === s) i++;
  }
  return i === sub.length;
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

  const nextDone = [...doneMoves, move];
  const nextRemaining = remainingFor(scrambleMoves, nextDone);

  if (nextRemaining.length === 0) {
    return { kind: 'complete', nextRemaining, nextDone, corrections: [], correctionActive: false };
  }

  // On the guided path — including doing adjacent commuting moves out of order
  // (`R L` played as `L R`): the remaining moves are still a subset of the scramble.
  if (isSubsequence(nextRemaining, scrambleMoves)) {
    return { kind: 'progress', nextRemaining, nextDone, corrections: [], correctionActive: false };
  }

  const suffixLen = commonSuffixLen(nextRemaining, scrambleMoves);
  const head = nextRemaining.slice(0, nextRemaining.length - suffixLen);

  if (head.length === 0) {
    return { kind: 'progress', nextRemaining, nextDone, corrections: [], correctionActive: false };
  }

  // `pivot` is the scramble move the correction head sits in front of.
  const pivot = scrambleMoves[scrambleMoves.length - suffixLen - 1];
  const isSameFacePartial =
    head.length === 1 && pivot !== undefined && sameFace(head[0], pivot);

  if (isSameFacePartial && !correctionActive) {
    return { kind: 'partial', nextRemaining, nextDone, corrections: head, correctionActive: false };
  }

  // A correction is owed. If this turn shrank the correction burden it's forward
  // progress toward the fix; otherwise it's a fresh or compounded mistake.
  const prevRemaining = remainingFor(scrambleMoves, doneMoves);
  const prevHeadLen = correctionHead(prevRemaining, scrambleMoves).length;
  const kind: ScrambleMoveKind = head.length < prevHeadLen ? 'progress' : 'error';

  return { kind, nextRemaining, nextDone, corrections: head, correctionActive: true };
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
