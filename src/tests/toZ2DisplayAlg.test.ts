import { describe, it, expect, beforeAll } from 'vitest';
import { cube3x3x3 } from 'cubing/puzzles';
import { Alg } from 'cubing/alg';
import type { KPattern } from 'cubing/kpuzzle';
import { toZ2DisplayAlg, isAllFaceTurns } from '../utils/kpuzzleHelper';

function patternsMatch(a: KPattern, b: KPattern): boolean {
  const ae = a.patternData.EDGES;
  const be = b.patternData.EDGES;
  const ac = a.patternData.CORNERS;
  const bc = b.patternData.CORNERS;
  return (
    ae.pieces.every((v: number, i: number) => v === be.pieces[i]) &&
    ae.orientation.every((v: number, i: number) => v === be.orientation[i]) &&
    ac.pieces.every((v: number, i: number) => v === bc.pieces[i]) &&
    ac.orientation.every((v: number, i: number) => v === bc.orientation[i])
  );
}

describe('toZ2DisplayAlg', () => {
  it('relabels face turns token by token (U↔D, L↔R, F/B fixed, direction kept)', () => {
    expect(toZ2DisplayAlg('U')).toBe('D');
    expect(toZ2DisplayAlg("D'")).toBe("U'");
    expect(toZ2DisplayAlg("R'")).toBe("L'");
    expect(toZ2DisplayAlg('L2')).toBe('R2');
    expect(toZ2DisplayAlg('F2')).toBe('F2');
    expect(toZ2DisplayAlg("B'")).toBe("B'");
    expect(toZ2DisplayAlg("D2'")).toBe("U2'");
    expect(toZ2DisplayAlg('')).toBe('');
    expect(toZ2DisplayAlg('   ')).toBe('');
    expect(toZ2DisplayAlg("R U R' F' D2' B L2'")).toBe("L D L' F' U2' B R2'");
  });

  it('token-stability: appending one raw move appends exactly one relabelled move', () => {
    // TwistyPlayerWrapper's incremental `experimentalAddMove` fast path diffs the alg string
    // token by token — a pure per-token map must keep the prefix identical.
    const base = "R U R' U' L D";
    for (const next of ['F', "R'", 'U2', "D'"]) {
      expect(toZ2DisplayAlg(`${base} ${next}`)).toBe(`${toZ2DisplayAlg(base)} ${toZ2DisplayAlg(next)}`);
    }
  });

  describe('isAllFaceTurns', () => {
    it('true for plain face-turn algs (incl. empty)', () => {
      expect(isAllFaceTurns('')).toBe(true);
      expect(isAllFaceTurns("R U R' F' D2' B L2' U2' F")).toBe(true);
      expect(isAllFaceTurns("D2 B2 F2 R' D2 R' B2 R D2 R U2")).toBe(true);
    });
    it('false when any token is a rotation / slice / wide (toZ2DisplayAlg cannot handle these)', () => {
      // These are the shapes reconstructAlgForPattern emits when a cube reports getPattern()
      // whole-cube-rotated — the connected views must fall back to the raw white-up view.
      expect(isAllFaceTurns("B U B' R' D2' L F2' U2' R y")).toBe(false);
      expect(isAllFaceTurns("L D L' F' U2' B R2' D2' F y2' x2'")).toBe(false);
      expect(isAllFaceTurns("D R D' F' L2' B U2' R2' F z'")).toBe(false);
      expect(isAllFaceTurns('R U M2 R')).toBe(false);
      expect(isAllFaceTurns('r U R')).toBe(false);
      expect(isAllFaceTurns('Rw U')).toBe(false);
    });
  });

  describe('physical-composition identity: solved · z2 · toZ2DisplayAlg(X) == solved · X · z2', () => {
    let solved: KPattern;
    beforeAll(async () => {
      solved = (await cube3x3x3.kpuzzle()).defaultPattern();
    });

    const CASES: string[] = [
      // WCA scrambles
      "R U2 F' L D2 B' R2 U' L' F2 D",
      "D' L2 U F2 U2 R2 D' B2 D2 R2 F2 D2 R' B' D2 R' U L' D' F'",
      "F' U' F2 D R2 U' R2 D' R2 U2 B U2 F' D2 F R2 B",
      // reconstructAlgForPattern-shaped seeds (default frame → face turns, `2'` modifiers)
      "R U R' F' D2' B L2' U2' F",
      // seed + a run of appended physical quarter-turns (what visualAlg looks like mid-solve)
      "R U R' F' D2' B L2' U2' F U R' U' R U R'",
      // short / partial sequences and the solved case
      "",
      "U",
      "R U R' U'",
      "D2 U2 L2 R2 F2 B2",
    ];

    for (const X of CASES) {
      it(`X = ${JSON.stringify(X)}`, () => {
        expect(isAllFaceTurns(X)).toBe(true); // guard: these cases are all face turns
        const viaRelabel = solved.applyAlg(new Alg('z2')).applyAlg(new Alg(toZ2DisplayAlg(X)));
        const viaZ2After = solved.applyAlg(new Alg(X || '')).applyAlg(new Alg('z2'));
        expect(patternsMatch(viaRelabel, viaZ2After)).toBe(true);
      });
    }
  });
});
