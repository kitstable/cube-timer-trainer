import type { KPattern } from 'cubing/kpuzzle';
import type { NotationMode, TechniqueTier } from '../types/cube';
import { CaseMatcher } from './caseMatcher';
import { solveCrossBFS } from './crossBfs';
import { solvePhasePrefix } from './fullSolveFallback';
import { isCrossSolved } from './cfopInvariants';

export interface HintQuery {
  phase: string;
  activeSlot?: string;
  techniqueTier?: TechniqueTier | string;
  tier?: string;
  notationMode?: NotationMode;
}

export interface HintResult {
  phase: string;
  moves: string[];
  caseName: string;
  subset?: string;
  targetSlot?: string;
}

/**
 * Phase-dispatch for a single guided-solve hint. Pure w.r.t. the passed
 * `pattern` — the worker owns the loop-guard state and passes `forceFallback`.
 *
 * Every branch is guaranteed to return a progressing move sequence for an
 * unsolved cube: the dedicated matchers first, then `solvePhasePrefix` (a
 * sliced full solve) as an always-available backstop. There are no fixed
 * "trigger" stubs that could leave the phase unchanged.
 */
export async function findHint(
  caseMatcher: CaseMatcher | null,
  pattern: KPattern,
  q: HintQuery,
  forceFallback = false
): Promise<HintResult> {
  let phase = q.phase;
  const tier = q.techniqueTier || q.tier || '2look';
  const notationMode = (q.notationMode || 'simplified') as NotationMode;
  const preferRotationless = tier === 'fullPLL' || tier === 'fullCFOP';
  const is1LookOLL = tier === 'fullCFOP';
  const is1LookPLL = tier === 'fullPLL' || tier === 'fullCFOP';
  const cm = forceFallback ? null : caseMatcher;

  // 1. Cross
  if (phase === 'cross') {
    let moves = forceFallback ? [] : solveCrossBFS(pattern, 8);
    if (moves.length === 0 && !forceFallback && !isCrossSolved(pattern)) {
      moves = solveCrossBFS(pattern, 10); // deeper retry before the generic fallback
    }
    let computed = false;
    if (moves.length === 0 && !isCrossSolved(pattern)) {
      moves = await solvePhasePrefix(pattern, 'cross');
      computed = true;
    }
    return { phase: 'cross', moves, caseName: computed ? 'White Cross (computed)' : 'White Cross' };
  }

  // 2. F2L
  if (phase.startsWith('f2l')) {
    const match =
      (cm
        ? cm.matchF2L(pattern, q.activeSlot, preferRotationless, notationMode) ||
          cm.matchIntuitiveF2L(pattern, q.activeSlot)
        : null) || null;

    if (match && match.moves.length > 0) {
      return {
        phase,
        moves: match.moves,
        caseName: match.caseName,
        subset: match.subset,
        targetSlot: match.targetSlot,
      };
    }

    const moves = await solvePhasePrefix(pattern, phase, q.activeSlot);
    return {
      phase,
      moves,
      caseName: `F2L · ${q.activeSlot || 'FR'} slot (computed)`,
      targetSlot: q.activeSlot,
    };
  }

  // 3. OLL
  if (phase === 'oll') {
    const match = cm
      ? is1LookOLL
        ? cm.matchOLL(pattern, notationMode)
        : cm.match2LookOLL(pattern, notationMode)
      : null;

    if (match && match.moves.length > 0) {
      return { phase: 'oll', moves: match.moves, caseName: match.caseName, subset: match.subset };
    }
    if (match && match.moves.length === 0) {
      phase = 'pll'; // OLL already done — fall through
    } else {
      const moves = await solvePhasePrefix(pattern, 'oll');
      return { phase: 'oll', moves, caseName: 'OLL (computed)' };
    }
  }

  // 4. PLL / AUF
  if (phase === 'pll' || phase === 'auf') {
    const match = cm
      ? is1LookPLL
        ? cm.matchPLL(pattern, notationMode)
        : cm.match2LookPLL(pattern, notationMode)
      : null;

    if (match && match.moves.length > 0) {
      return { phase: 'pll', moves: match.moves, caseName: match.caseName, subset: match.subset };
    }
    if (match && match.moves.length === 0) {
      return { phase: 'solved', moves: [], caseName: 'Cube Solved!' };
    }
    const moves = await solvePhasePrefix(pattern, 'pll');
    return {
      phase: moves.length > 0 ? 'pll' : 'solved',
      moves,
      caseName: moves.length > 0 ? 'PLL (computed)' : 'Cube Solved!',
    };
  }

  return { phase, moves: [], caseName: 'Guidance' };
}
