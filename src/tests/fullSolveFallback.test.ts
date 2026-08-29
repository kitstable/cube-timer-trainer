import { describe, it, expect, beforeAll } from 'vitest';
import { Alg } from 'cubing/alg';
import { getKPuzzle, getPostZ2Pattern } from '../utils/kpuzzleHelper';
import { reconstructAlgForPattern } from '../solver/fullSolveFallback';

function patternsMatch(a: any, b: any): boolean {
  const ae = a.patternData.EDGES;
  const be = b.patternData.EDGES;
  const ac = a.patternData.CORNERS;
  const bc = b.patternData.CORNERS;
  return (
    ae.pieces.every((p: number, i: number) => p === be.pieces[i]) &&
    ae.orientation.every((o: number, i: number) => o === be.orientation[i]) &&
    ac.pieces.every((p: number, i: number) => p === bc.pieces[i]) &&
    ac.orientation.every((o: number, i: number) => o === bc.orientation[i])
  );
}

describe('reconstructAlgForPattern', () => {
  beforeAll(async () => {
    await getKPuzzle();
  });

  it('returns an empty alg for an already-solved pattern', async () => {
    const pattern = getPostZ2Pattern();
    const alg = await reconstructAlgForPattern(pattern);
    expect(alg).toBe('');
  });

  it('reconstructs a scrambled pattern such that solved + alg == pattern', async () => {
    const scramble = "R U R' F' D2 B L2";
    const pattern = getPostZ2Pattern().applyAlg(new Alg(scramble));

    const alg = await reconstructAlgForPattern(pattern);
    expect(alg.length).toBeGreaterThan(0);

    const reconstructed = getPostZ2Pattern().applyAlg(new Alg(alg));
    expect(patternsMatch(reconstructed, pattern)).toBe(true);
  });

  it('reconstructs a full WCA-length scramble correctly', async () => {
    const scramble = "D2 B2 F2 R' D2 R' B2 R D2 R U2 F L' U' F' L2 D B2 D R2";
    const pattern = getPostZ2Pattern().applyAlg(new Alg(scramble));

    const alg = await reconstructAlgForPattern(pattern);
    const reconstructed = getPostZ2Pattern().applyAlg(new Alg(alg));
    expect(patternsMatch(reconstructed, pattern)).toBe(true);
  });
});
