/**
 * 2-Look training drills — each drill is a CFOP sub-step locked to a tiny alg set.
 *
 * The point isn't to memorise 57 OLLs / 21 PLLs but to practise a step with the
 * beginner alg set (e.g. orient the last-layer corners using only Sune / Anti-Sune),
 * recognising which combination solves each case.
 *
 * Everything here is pure: predicates read `patternData` piece arrays; `solveWithAlgSet`
 * is a small BFS over last-layer states. Alg strings are the human-readable dataset
 * algorithms (wide / slice moves included — cubing.js applies them fine); a test asserts
 * they stay in sync with `cfop-algorithms.json`.
 */
import { Alg } from 'cubing/alg';
import type { KPattern } from 'cubing/kpuzzle';
import { isFullySolved, isF2LSolved, isOLLSolved, SOLVED_CORNER_PIECES } from './cfopInvariants';
import type { AlgorithmDataset, AlgorithmEntry } from '../types/solver';

export type TwoLookDrillId = 'oll-edges' | 'oll-corners' | 'pll-corners' | 'pll-edges';

export interface AlgOption {
  label: string;
  alg: string;
}

export interface TwoLookDrill {
  id: TwoLookDrillId;
  label: string;
  /** Which Training sub-mode this drill belongs under. */
  subMode: 'OLL' | 'PLL';
  /** Where the scramble generator should look the target case up. */
  caseSource: 'OLL' | 'PLL' | 'OLL_2LOOK_EDGE';
  /** Dataset case names this drill scrambles into. */
  caseNames: string[];
  /** The alg set the drill is practised with (on-screen buttons + `Show me` hint). */
  algs: AlgOption[];
  /** One-line description of the goal. */
  goal: string;
}

const AUFS = ['', 'U', 'U2', "U'"];

function withAuf(p: KPattern, auf: string): KPattern {
  return auf ? p.applyAlg(new Alg(auf)) : p;
}

// --- completion predicates (post-z2 frame; U layer = indices 0..3) ------------

/** Yellow cross made (all 4 top edges oriented), F2L still intact. Corners may be twisted. */
export function isYellowCrossSolved(p: KPattern): boolean {
  const e = p.patternData.EDGES;
  return (
    isF2LSolved(p) &&
    e.orientation[0] === 0 &&
    e.orientation[1] === 0 &&
    e.orientation[2] === 0 &&
    e.orientation[3] === 0
  );
}

export { isOLLSolved };

/** OLL done and the top corners are home (up to a final AUF); top edges may still be off. */
export function areTopCornersPlaced(p: KPattern): boolean {
  if (!isOLLSolved(p)) return false;
  return AUFS.some((auf) => {
    const c = withAuf(p, auf).patternData.CORNERS;
    return (
      c.pieces[0] === SOLVED_CORNER_PIECES[0] &&
      c.pieces[1] === SOLVED_CORNER_PIECES[1] &&
      c.pieces[2] === SOLVED_CORNER_PIECES[2] &&
      c.pieces[3] === SOLVED_CORNER_PIECES[3]
    );
  });
}

/** Cube solved, ignoring a final AUF. */
export function isSolvedUpToAuf(p: KPattern): boolean {
  return AUFS.some((auf) => isFullySolved(withAuf(p, auf)));
}

// --- combo solver ------------------------------------------------------------

export interface ComboStep {
  /** Human label, e.g. `U2 Sune`. */
  label: string;
  /** Executable alg, e.g. `U2 R U R' U R U2' R'`. */
  alg: string;
}

function signature(p: KPattern): string {
  const e = p.patternData.EDGES;
  const c = p.patternData.CORNERS;
  return `${e.pieces}|${e.orientation}|${c.pieces}|${c.orientation}`;
}

/**
 * Shortest sequence of `(AUF + one alg from algs)` taking `start` to a state where
 * `isDone` holds. BFS over last-layer states, deduped by full piece signature.
 * `maxAlgs` caps the number of alg applications. Returns `null` if unreachable.
 */
export function solveWithAlgSet(
  start: KPattern,
  algs: AlgOption[],
  isDone: (p: KPattern) => boolean,
  maxAlgs = 4
): ComboStep[] | null {
  if (isDone(start)) return [];

  let frontier: { p: KPattern; path: ComboStep[] }[] = [{ p: start, path: [] }];
  const seen = new Set<string>([signature(start)]);

  for (let depth = 0; depth < maxAlgs; depth++) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      for (const auf of AUFS) {
        const base = withAuf(node.p, auf);
        for (const a of algs) {
          const np = base.applyAlg(new Alg(a.alg));
          const sig = signature(np);
          if (seen.has(sig)) continue;
          seen.add(sig);
          const prefix = auf ? `${auf} ` : '';
          const path = [...node.path, { label: prefix + a.label, alg: prefix + a.alg }];
          if (isDone(np)) return path;
          next.push({ p: np, path });
        }
      }
    }
    frontier = next;
  }
  return null;
}

/** The AUF (if any) that finishes the cube after a combo — for a "…then align U" hint. */
export function finishingAuf(p: KPattern): string | null {
  for (const auf of AUFS) {
    if (isFullySolved(withAuf(p, auf))) return auf || 'solved';
  }
  return null;
}

// --- drill catalogue --------------------------------------------------------

export function drillPredicate(id: TwoLookDrillId): (p: KPattern) => boolean {
  switch (id) {
    case 'oll-edges':
      return isYellowCrossSolved;
    case 'oll-corners':
      return isOLLSolved;
    case 'pll-corners':
      return areTopCornersPlaced;
    case 'pll-edges':
      return isSolvedUpToAuf;
  }
}

/**
 * Resolves the 4 drills against the shipped dataset (alg strings + case-name pools).
 * Kept data-driven so it can't drift from `cfop-algorithms.json` — a test cross-checks it.
 */
export function buildTwoLookDrills(dataset: AlgorithmDataset): Record<TwoLookDrillId, TwoLookDrill> {
  const byName = (list: AlgorithmEntry[] | undefined, name: string): AlgorithmEntry | undefined =>
    (list ?? []).find((e) => e.name === name);
  const opt = (label: string, e?: AlgorithmEntry): AlgOption => ({ label, alg: e?.algorithm ?? '' });

  const edgeCases = dataset.OLL_2LOOK_EDGE_ORIENTATION ?? [];
  const cornerCaseNames = dataset.OLL.filter((e) => e.subset === 'Oriented Edges').map((e) => e.name);

  return {
    'oll-edges': {
      id: 'oll-edges',
      label: 'Orient edges',
      subMode: 'OLL',
      caseSource: 'OLL_2LOOK_EDGE',
      caseNames: edgeCases.map((e) => e.name),
      algs: [
        opt('Line', byName(edgeCases, 'Edges: Line')),
        opt('L-shape', byName(edgeCases, 'Edges: L-shape')),
        opt('Dot', byName(edgeCases, 'Edges: Dot')),
      ],
      goal: 'Make the yellow cross',
    },
    'oll-corners': {
      id: 'oll-corners',
      label: 'Orient corners',
      subMode: 'OLL',
      caseSource: 'OLL',
      caseNames: cornerCaseNames,
      algs: [
        opt('Sune', byName(dataset.OLL, 'OLL-27 Sune')),
        opt('Anti-Sune', byName(dataset.OLL, 'OLL-26 Anti Sune')),
      ],
      goal: 'Orient the last-layer corners',
    },
    'pll-corners': {
      id: 'pll-corners',
      label: 'Permute corners',
      subMode: 'PLL',
      caseSource: 'PLL',
      caseNames: ['Aa Perm', 'Ab Perm'],
      algs: [opt('Aa', byName(dataset.PLL, 'Aa Perm')), opt('Ab', byName(dataset.PLL, 'Ab Perm'))],
      goal: 'Place the last-layer corners',
    },
    'pll-edges': {
      id: 'pll-edges',
      label: 'Permute edges',
      subMode: 'PLL',
      caseSource: 'PLL',
      caseNames: ['Ua Perm', 'Ub Perm', 'H Perm', 'Z Perm'],
      algs: [
        opt('Ua', byName(dataset.PLL, 'Ua Perm')),
        opt('Ub', byName(dataset.PLL, 'Ub Perm')),
        opt('H', byName(dataset.PLL, 'H Perm')),
        opt('Z', byName(dataset.PLL, 'Z Perm')),
      ],
      goal: 'Solve the last-layer edges',
    },
  };
}
