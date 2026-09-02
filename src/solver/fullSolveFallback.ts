import type { KPattern } from 'cubing/kpuzzle';
import { Alg } from 'cubing/alg';
import { experimentalSolve3x3x3IgnoringCenters } from 'cubing/search';
import { simplifyMoveSequence } from '../utils/moveSimplifier';
import { WHOLE_CUBE_ROTATIONS } from '../utils/kpuzzleHelper';
import {
  isCrossSolved,
  isSlotSolved,
  isOLLSolved,
  isFullySolved,
  preservesProgress,
  type F2LSlot,
} from './cfopInvariants';

/**
 * Guaranteed, always-progressing hint for any CFOP phase.
 *
 * Computes a full outer-move solution for the current pattern (via cubing.js
 * search) and returns the shortest leading slice of it that reaches the goal
 * for `phase`. Because a full solve always exists and always ends solved, this
 * can never return an empty / non-progressing sequence for an unsolved cube —
 * it is the backstop that makes the guided walkthrough impossible to get stuck
 * in a loop.
 *
 * Slower than a case-database lookup (tens of ms), so it is only used when the
 * dedicated matchers find nothing. The worker surfaces a "Calculating…" state
 * while it runs.
 */

// The app works in the "post-z2" frame; cubing.js's 3x3x3 solver rejects a
// z2-rotated pattern ("non-oriented puzzles are not supported"). So solve in the
// default frame (apply z2 to undo the app's rotation) and relabel the solution
// back through z2 — a 180° turn that swaps U<->D and L<->R, leaving F/B.
export const Z2_RELABEL: Record<string, string> = { U: 'D', D: 'U', L: 'R', R: 'L', F: 'F', B: 'B' };

/** Relabel one move's face letter across a z2 rotation (U↔D, L↔R, F/B unchanged), keeping its modifier. */
export function relabelMoveZ2Face(move: string): string {
  return (Z2_RELABEL[move[0]] ?? move[0]) + move.slice(1);
}

export async function solvePhasePrefix(
  pattern: KPattern,
  phase: string,
  activeSlot?: string
): Promise<string[]> {
  const solution = await experimentalSolve3x3x3IgnoringCenters(pattern.applyAlg(new Alg('z2')));
  const moves = Array.from(solution.experimentalLeafMoves()).map((m) => relabelMoveZ2Face(m.toString()));

  const slot = (activeSlot || 'FR') as F2LSlot;
  const goalReached = (p: KPattern): boolean => {
    if (phase.startsWith('f2l')) {
      return isSlotSolved(p, slot) && preservesProgress(pattern, p);
    }
    if (phase === 'oll') return isOLLSolved(p);
    // pll / auf / anything else: solve it outright
    return isFullySolved(p);
  };

  let cur = pattern;
  if (goalReached(cur)) return [];

  const prefix: string[] = [];
  for (const m of moves) {
    cur = cur.applyAlg(new Alg(m));
    prefix.push(m);
    if (goalReached(cur)) break;
    // For cross: stop as soon as the cross is in (don't solve the whole cube).
    if (phase === 'cross' && isCrossSolved(cur)) break;
  }

  return simplifyMoveSequence(prefix);
}

/**
 * Computes an alg `X` such that `solved.applyAlg(X)` is exactly `pattern` — i.e. the moves
 * that reconstruct a live physical cube state from solved, for 3D visualization when the
 * app has only a `KPattern` read off a smart cube and no scramble string that produced it.
 *
 * The wrinkle: `experimentalSolve3x3x3IgnoringCenters` rejects any pattern whose centers
 * aren't solved ("non-oriented puzzles are not supported"), and different smart-cube
 * calibrations hand back `getPattern()` in different whole-cube orientations — usually the
 * library default (facelet-derived, solved centers), but sometimes z2-rotated or otherwise
 * turned. So first find the whole-cube rotation `rot` that lands the *centers* solved (a
 * cheap permutation check, no solve), then solve `pattern · rot` once (S). Then
 * `X = (rot · S)⁻¹` because `pattern · rot · S = solved`. The result carries any needed
 * `rot⁻¹`, so the visualizer shows the cube exactly as its sensor reports it and appended
 * physical moves stay consistent. Returns `''` if no rotation solves the centers.
 */
function centersSolved(pattern: KPattern): boolean {
  const c = pattern.patternData.CENTERS;
  if (!c) return true; // puzzle without a CENTERS orbit — nothing to normalise
  return c.pieces.every((p: number, i: number) => p === i);
}

export async function reconstructAlgForPattern(pattern: KPattern): Promise<string> {
  let rot = '';
  if (!centersSolved(pattern)) {
    rot =
      WHOLE_CUBE_ROTATIONS.find(
        (r) => r !== '' && centersSolved(pattern.applyAlg(new Alg(r)))
      ) ?? '';
    if (rot === '') return ''; // no orientation solves the centers — give up cleanly
  }

  const rotated = rot ? pattern.applyAlg(new Alg(rot)) : pattern;
  let solution;
  try {
    solution = await experimentalSolve3x3x3IgnoringCenters(rotated);
  } catch {
    return '';
  }
  const moves = Array.from(solution.experimentalLeafMoves()).map((m) => m.toString());
  const combined = [...(rot ? [rot] : []), ...moves].join(' ').trim();
  if (!combined) return '';
  return new Alg(combined).invert().toString();
}

