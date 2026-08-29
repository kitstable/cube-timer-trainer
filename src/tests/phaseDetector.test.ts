import { describe, it, expect, beforeAll } from 'vitest';
import { Alg } from 'cubing/alg';
import { getKPuzzle, getPostZ2Pattern } from '../utils/kpuzzleHelper';
import { evaluateCFOPFromPattern, resolveMonotonicCFOPPhase } from '../utils/phaseDetector';

describe('CFOP Phase Detector', () => {
  beforeAll(async () => {
    await getKPuzzle();
  });

  it('correctly detects solved state in post-z2 frame', () => {
    const pattern = getPostZ2Pattern();
    const status = evaluateCFOPFromPattern(pattern);

    expect(status.isCrossSolved).toBe(true);
    expect(status.solvedSlots).toEqual(['FR', 'FL', 'BR', 'BL']);
    expect(status.isF2LSolved).toBe(true);
    expect(status.isOLLSolved).toBe(true);
    expect(status.isPLLSolved).toBe(true);
    expect(status.isFullySolved).toBe(true);
    expect(status.currentPhase).toBe('solved');
  });

  it('detects scrambled cross on a standard scramble', async () => {
    const kp = await getKPuzzle();
    const scrambled = kp.defaultPattern().applyAlg(new Alg("R U R' U' z2"));
    const status = evaluateCFOPFromPattern(scrambled);

    expect(status.isFullySolved).toBe(false);
  });

  it('correctly detects solved state in default physical frame', async () => {
    const kp = await getKPuzzle();
    const pattern = kp.defaultPattern();
    const status = evaluateCFOPFromPattern(pattern);

    expect(status.isFullySolved).toBe(true);
    expect(status.currentPhase).toBe('solved');
  });

  it('correctly detects solved state across whole-cube rotations (e.g. y, x2, z)', async () => {
    const kp = await getKPuzzle();
    for (const rot of ['y', "y'", 'y2', 'x', 'x2', 'z', "z'"]) {
      const rotatedSolved = kp.defaultPattern().applyAlg(new Alg(rot));
      const status = evaluateCFOPFromPattern(rotatedSolved);
      expect(status.isFullySolved).toBe(true);
      expect(status.currentPhase).toBe('solved');
    }
  });

  it('maintains monotonic progression across temporary disruption moves', () => {
    // Current highest phase is F2L-3
    const resolved = resolveMonotonicCFOPPhase('f2l-3', ['FR', 'FL'], {
      isCrossSolved: false, // temporarily broken during sexy move
      solvedSlots: [],
      isF2LSolved: false,
      isOLLSolved: false,
      isPLLSolved: false,
      isFullySolved: false,
      currentPhase: 'cross',
    });

    expect(resolved.phase).toBe('f2l-3');
    expect(resolved.solvedSlots).toEqual(['FR', 'FL']);
  });
});
