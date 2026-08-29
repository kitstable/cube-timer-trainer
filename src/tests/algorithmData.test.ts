import { describe, it, expect, beforeAll } from 'vitest';
import { cube3x3x3 } from 'cubing/puzzles';
import { Alg } from 'cubing/alg';
import type { KPattern, KPuzzle } from 'cubing/kpuzzle';
import {
  isCrossSolved,
  isSlotSolved,
  isOLLSolved,
  preservesProgress,
  ALL_F2L_SLOTS,
  type F2LSlot,
} from '../solver/cfopInvariants';
import data from '../data/cfop-algorithms.json';

let kpuzzle: KPuzzle;
let SOLVED_Z2: KPattern;

beforeAll(async () => {
  kpuzzle = await cube3x3x3.kpuzzle();
  SOLVED_Z2 = kpuzzle.defaultPattern().applyAlg(new Alg('z2'));
});

const leaves = (s: string) =>
  Array.from(new Alg(s).experimentalLeafMoves()).map((m) => m.toString());
const isOuterOnly = (s: string) => leaves(s).every((m) => /^[UDLRFB]([2']|2')?$/.test(m) || /^[UDLRFB]2$/.test(m));
const setupFor = (alg: string) => SOLVED_Z2.applyAlg(new Alg(alg).invert());
const slotFromName = (n: string): F2LSlot =>
  n.includes('Front Left') ? 'FL' : n.includes('Back Right') ? 'BR' : n.includes('Back Left') ? 'BL' : 'FR';

describe('shipped cfop-algorithms.json is valid', () => {
  it('has the expected case counts', () => {
    expect(data.OLL).toHaveLength(57);
    expect(data.PLL).toHaveLength(21);
    expect(data.F2L).toHaveLength(164);
    expect(data.OLL_2LOOK_EDGE_ORIENTATION).toHaveLength(3);
  });

  it('every algorithmSimplified is single-outer-layer-turns only', () => {
    for (const e of [...data.OLL, ...data.PLL, ...data.F2L, ...data.OLL_2LOOK_EDGE_ORIENTATION]) {
      expect(e.algorithmSimplified, e.name).toBeTruthy();
      expect(isOuterOnly(e.algorithmSimplified!), `${e.name}: "${e.algorithmSimplified}"`).toBe(true);
    }
  });

  it('every OLL alg orients the last layer and keeps F2L', () => {
    for (const e of data.OLL) {
      const setup = setupFor(e.algorithm);
      expect(preservesProgress(SOLVED_Z2, setup), `${e.name} setup`).toBe(true);
      for (const a of [e.algorithm, e.algorithmSimplified!]) {
        expect(isOLLSolved(setup.applyAlg(new Alg(a))), `${e.name} / ${a}`).toBe(true);
      }
    }
  });

  it('every PLL alg solves the last layer up to an AUF', () => {
    const solvedUpToAuf = (p: KPattern) =>
      ['', 'U', "U'", 'U2'].some((auf) => {
        const q = auf ? p.applyAlg(new Alg(auf)) : p;
        const te = SOLVED_Z2.patternData.EDGES, tc = SOLVED_Z2.patternData.CORNERS;
        return (
          q.patternData.EDGES.pieces.every((v: number, i: number) => v === te.pieces[i]) &&
          q.patternData.CORNERS.pieces.every((v: number, i: number) => v === tc.pieces[i])
        );
      });
    for (const e of data.PLL) {
      const setup = setupFor(e.algorithm);
      for (const a of [e.algorithm, e.algorithmSimplified!]) {
        expect(solvedUpToAuf(setup.applyAlg(new Alg(a))), `${e.name} / ${a}`).toBe(true);
      }
    }
  });

  it('every F2L variant solves its own slot without disturbing cross or other slots', () => {
    for (const e of data.F2L) {
      const slot = slotFromName(e.name);
      const setup = SOLVED_Z2.applyAlg(new Alg(e.algorithm).invert());
      // setup must be a clean single-slot case
      expect(isCrossSolved(setup), `${e.name} setup cross`).toBe(true);
      for (const s of ALL_F2L_SLOTS) {
        if (s !== slot) expect(isSlotSolved(setup, s), `${e.name} setup keeps ${s}`).toBe(true);
      }
      for (const a of [e.algorithm, e.algorithmSimplified!]) {
        const after = setup.applyAlg(new Alg(a));
        expect(isSlotSolved(after, slot), `${e.name} / ${a} solves ${slot}`).toBe(true);
        expect(preservesProgress(setup, after), `${e.name} / ${a} preserves progress`).toBe(true);
      }
    }
  });
});
