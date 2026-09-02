import type { KPattern } from 'cubing/kpuzzle';
import { Alg } from 'cubing/alg';
import { experimentalSolve3x3x3IgnoringCenters } from 'cubing/search';
import { relabelMoveZ2Face } from './fullSolveFallback';
import { simplifyMoveSequence } from '../utils/moveSimplifier';
import type { PrecomputedCase } from './caseMatcher';

/**
 * Case-targeted scramble generator for Training mode.
 *
 * Given a CFOP case (OLL / PLL / F2L), produces a scramble that lands a physically solved
 * cube on that case — WITHOUT the scramble being a giveaway of the solving algorithm.
 *
 * Variety per case:
 *  - OLL / PLL: random AUF only. The spec (§5 step 3) proposed layering a random PLL on top
 *    of an OLL case for permutation noise, on the premise that "PLL doesn't touch
 *    orientation". That premise only holds on an already-oriented last layer — applied to a
 *    misoriented OLL case, a PLL permutes the orientation values *among the four LL
 *    positions*, so `matchOLL` (which compares orientation position-by-position, up to AUF)
 *    no longer identifies the intended case and, worse, the drilled OLL alg wouldn't
 *    actually solve it. So permutation noise is dropped for OLL. `randomisePermutation` is
 *    kept for F2L, where LL noise above the slot is harmless.
 *  - F2L: `randomisePermutation: true` — a random AUF + random PLL on the last layer, which
 *    F2L completion (`isSlotSolved` on the drilled slot) is indifferent to.
 *
 * Frame handling mirrors `solvePhasePrefix` in `fullSolveFallback.ts` exactly — see the
 * cube-physics-gotchas section of CLAUDE.md. Do not deviate: the target is built in the
 * app's post-z2 frame; `experimentalSolve3x3x3IgnoringCenters` needs solved centers so we
 * apply `z2` again before solving, then relabel each solution move's face across z2.
 *
 * The generated sequence is in the same post-z2 frame the case matchers expect, so the
 * correctness test can feed `solvedPostZ2.applyAlg(scramble)` straight to `matchOLL` /
 * `matchPLL` as an oracle.
 */

const AUF = ['', 'U', "U'", 'U2'];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Outer-move-only inverse of a case's algorithm (rotation/wide-free, so it solves cleanly). */
function invSimplified(c: PrecomputedCase): Alg {
  return new Alg(c.algSimplifiedMoves.join(' ')).invert();
}

export async function generateCaseScramble(
  solvedPostZ2: KPattern,
  targetCase: PrecomputedCase,
  opts: { randomisePermutation: boolean; pllPool?: PrecomputedCase[] }
): Promise<string[]> {
  // Start from the case state (solved cube with the case's inverse alg applied).
  let target = solvedPostZ2.applyAlg(invSimplified(targetCase));

  // Random AUF — where the U layer sits is not part of any case.
  const auf = pick(AUF);
  if (auf) target = target.applyAlg(new Alg(auf));

  // For OLL/F2L: a random PLL permutes the last layer without touching orientation, so it
  // adds visual noise and varies the scramble while leaving the drilled case intact. For
  // PLL training itself, skip this (permutation IS the case) — caller passes false.
  if (opts.randomisePermutation && opts.pllPool && opts.pllPool.length > 0) {
    const noise = pick(opts.pllPool);
    target = target.applyAlg(new Alg(noise.algSimplifiedMoves.join(' ')));
  }

  const solution = await experimentalSolve3x3x3IgnoringCenters(target.applyAlg(new Alg('z2')));
  const moves = Array.from(solution.experimentalLeafMoves()).map((m) => relabelMoveZ2Face(m.toString()));

  // Invert the solution to get the scramble, then normalise token notation (F2' -> F2 etc.).
  const inverted = new Alg(moves.join(' ')).invert().toString().trim();
  return inverted.length > 0 ? simplifyMoveSequence(inverted.split(/\s+/)) : [];
}
