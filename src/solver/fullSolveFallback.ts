import type { KPattern } from 'cubing/kpuzzle';
import { Alg } from 'cubing/alg';
import { experimentalSolve3x3x3IgnoringCenters } from 'cubing/search';
import { simplifyMoveSequence } from '../utils/moveSimplifier';
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
const Z2_RELABEL: Record<string, string> = { U: 'D', D: 'U', L: 'R', R: 'L', F: 'F', B: 'B' };

export async function solvePhasePrefix(
  pattern: KPattern,
  phase: string,
  activeSlot?: string
): Promise<string[]> {
  const solution = await experimentalSolve3x3x3IgnoringCenters(pattern.applyAlg(new Alg('z2')));
  const moves = Array.from(solution.experimentalLeafMoves()).map((m) => {
    const s = m.toString();
    return (Z2_RELABEL[s[0]] ?? s[0]) + s.slice(1);
  });

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

