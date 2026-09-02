import { describe, it, expect, beforeAll } from 'vitest';
import { cube3x3x3 } from 'cubing/puzzles';
import { Alg } from 'cubing/alg';
import type { KPattern } from 'cubing/kpuzzle';
import { relabelForDisplay } from '../utils/relabelForDisplay';

function patternsMatch(a: KPattern, b: KPattern): boolean {
  const ae = a.patternData.EDGES,
    be = b.patternData.EDGES;
  const ac = a.patternData.CORNERS,
    bc = b.patternData.CORNERS;
  return (
    ae.pieces.every((v: number, i: number) => v === be.pieces[i]) &&
    ae.orientation.every((v: number, i: number) => v === be.orientation[i]) &&
    ac.pieces.every((v: number, i: number) => v === bc.pieces[i]) &&
    ac.orientation.every((v: number, i: number) => v === bc.orientation[i])
  );
}

describe('relabelForDisplay', () => {
  it('token-level mappings', () => {
    expect(relabelForDisplay('U')).toBe('D');
    expect(relabelForDisplay("D'")).toBe("U'");
    expect(relabelForDisplay("R'")).toBe("L'");
    expect(relabelForDisplay('L2')).toBe('R2');
    expect(relabelForDisplay('F2')).toBe('F2');
    expect(relabelForDisplay("B'")).toBe("B'");
    expect(relabelForDisplay('M')).toBe("M'");
    expect(relabelForDisplay("M'")).toBe('M');
    expect(relabelForDisplay('M2')).toBe('M2');
    expect(relabelForDisplay('E')).toBe("E'");
    expect(relabelForDisplay('S')).toBe('S');
    expect(relabelForDisplay("S'")).toBe("S'");
    expect(relabelForDisplay('x')).toBe("x'");
    expect(relabelForDisplay("y'")).toBe('y');
    expect(relabelForDisplay('z2')).toBe('z2');
    expect(relabelForDisplay('z')).toBe('z');
    expect(relabelForDisplay('r')).toBe('l');
    expect(relabelForDisplay('Rw')).toBe('Lw');
    expect(relabelForDisplay('f')).toBe('f');
    expect(relabelForDisplay("R2'")).toBe('L2'); // 2' modifier normalizes to 2
    expect(relabelForDisplay('(R)')).toBe('(R)'); // unrecognised token passes through
    expect(relabelForDisplay('')).toBe('');
    expect(relabelForDisplay('U R2 F')).toBe('D L2 F');
    expect(relabelForDisplay("y' x R U R'")).toBe("y x' L D L'");
  });

  it('token-stability: appending one move relabels independently', () => {
    const base = "R U R' U'";
    expect(relabelForDisplay(`${base} F`)).toBe(`${relabelForDisplay(base)} ${relabelForDisplay('F')}`);
    expect(relabelForDisplay(`${base} M2`)).toBe(`${relabelForDisplay(base)} M2`);
  });

  describe('state equality: solved·z2·relabelForDisplay(X) == solved·X·z2', () => {
    let solved: KPattern;
    beforeAll(async () => {
      solved = (await cube3x3x3.kpuzzle()).defaultPattern();
    });

    const CASES = [
      "R U2 F' L D2 B' R2 U' L' F2 D",
      "D' L2 U F2 U2 R2 D' B2 D2 R2 F2 D2 R' B' D2 R' U L' D' F'",
      "f R U r' M2 S E'",
      "y' x R U R' F2 M' D",
      "Rw U Lw' Dw2 Fw' Bw",
      "M2 U' M2 U2 M2 U' M2", // H-perm
      "x R' U R' D2 R U' R' D2 R2 x'", // Aa-perm
    ];

    for (const X of CASES) {
      it(`X = "${X}"`, () => {
        const viaRelabel = solved.applyAlg(new Alg('z2')).applyAlg(new Alg(relabelForDisplay(X)));
        const viaZ2After = solved.applyAlg(new Alg(X)).applyAlg(new Alg('z2'));
        expect(patternsMatch(viaRelabel, viaZ2After)).toBe(true);
      });
    }
  });
});
