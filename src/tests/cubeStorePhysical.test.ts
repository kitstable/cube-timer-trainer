import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Alg } from 'cubing/alg';
import { getKPuzzle, getDefaultPattern, isPatternSolved } from '../utils/kpuzzleHelper';
import { useCubeStore } from '../store/useCubeStore';

/**
 * `physicalPattern` must stay a faithful model of the real cube: seeded by a state read,
 * advanced by every turn, and — crucially — never clobbered by `setScramble`. That's what
 * lets connected Scramble mode answer "is the cube actually solved?" (it holds the guided
 * scramble in "return to solved" and ignores physical turns until then).
 */
describe('useCubeStore.physicalPattern', () => {
  beforeAll(async () => {
    await getKPuzzle();
  });

  beforeEach(async () => {
    await useCubeStore.getState().init();
    useCubeStore.setState({ physicalPattern: null, visualAlg: '' });
  });

  it('is seeded by syncPhysicalPattern and reflects a scrambled read', () => {
    const scrambled = getDefaultPattern().applyAlg(new Alg("R U R' U' F2 D"));
    useCubeStore.getState().syncPhysicalPattern(scrambled);

    const { physicalPattern } = useCubeStore.getState();
    expect(physicalPattern).not.toBeNull();
    expect(isPatternSolved(physicalPattern)).toBe(false);
  });

  it('advances with each applyMove and reads solved once the cube is solved again', () => {
    const scramble = "R U R' U'";
    const scrambled = getDefaultPattern().applyAlg(new Alg(scramble));
    useCubeStore.getState().syncPhysicalPattern(scrambled);
    expect(isPatternSolved(useCubeStore.getState().physicalPattern)).toBe(false);

    // Undo the scramble physically, one turn at a time.
    for (const m of new Alg(scramble).invert().toString().split(/\s+/)) {
      useCubeStore.getState().applyMove(m, Date.now());
    }

    expect(isPatternSolved(useCubeStore.getState().physicalPattern)).toBe(true);
  });

  it('survives setScramble (which overwrites `pattern` with the z2 target)', async () => {
    const scrambled = getDefaultPattern().applyAlg(new Alg("R U R' U' F2 D"));
    useCubeStore.getState().syncPhysicalPattern(scrambled);
    const before = useCubeStore.getState().physicalPattern;

    await useCubeStore.getState().setScramble("D2 F2 R2 U");

    const after = useCubeStore.getState().physicalPattern;
    expect(after).toBe(before); // untouched
    expect(isPatternSolved(after)).toBe(false);
  });
});
