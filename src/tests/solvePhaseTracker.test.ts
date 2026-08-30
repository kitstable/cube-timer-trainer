import { describe, it, expect, beforeAll } from 'vitest';
import { Alg } from 'cubing/alg';
import type { KPattern } from 'cubing/kpuzzle';
import { getKPuzzle, getDefaultPattern, relabelMoveZ2 } from '../utils/kpuzzleHelper';
import { evaluateCFOPFromPattern, resolveMonotonicCFOPPhase } from '../utils/phaseDetector';
import { solveCrossBFS } from '../solver/crossBfs';
import { solvePhasePrefix } from '../solver/fullSolveFallback';
import type { CFOPPhase, F2LSlotId } from '../types/cube';

describe('relabelMoveZ2', () => {
  it('swaps U<->D and L<->R, keeps F/B and modifiers', () => {
    expect(relabelMoveZ2('U')).toBe('D');
    expect(relabelMoveZ2("U'")).toBe("D'");
    expect(relabelMoveZ2('U2')).toBe('D2');
    expect(relabelMoveZ2('D')).toBe('U');
    expect(relabelMoveZ2('L2')).toBe('R2');
    expect(relabelMoveZ2("R'")).toBe("L'");
    expect(relabelMoveZ2('F')).toBe('F');
    expect(relabelMoveZ2("B'")).toBe("B'");
  });
  it('passes rotations / unknown tokens through unchanged', () => {
    expect(relabelMoveZ2('y')).toBe('y');
    expect(relabelMoveZ2("x'")).toBe("x'");
    expect(relabelMoveZ2('z2')).toBe('z2');
  });
});

/**
 * The connected Timed Solve CFOP tracker seeds from `default · scramble · z2` and advances
 * by `relabelMoveZ2` of each physical move (reported in the cube's default/calibrated
 * frame). This is the frame in which phase detection actually tracks a solve — verified
 * here against the raw-frame approach, which never detects the cross.
 */
describe('solve phase tracker frame', () => {
  beforeAll(async () => {
    await getKPuzzle();
  });

  async function realCfopSolvePostZ2(startPostZ2: KPattern) {
    let p = startPostZ2;
    const moves: string[] = [];
    const push = (ms: string[]) => {
      for (const m of ms) {
        p = p.applyAlg(new Alg(m));
        moves.push(m);
      }
    };
    const crossMoves = solveCrossBFS(startPostZ2, 8);
    push(crossMoves);
    for (const slot of ['FR', 'FL', 'BR', 'BL']) push(await solvePhasePrefix(p, 'f2l', slot));
    push(await solvePhasePrefix(p, 'oll'));
    push(await solvePhasePrefix(p, 'pll'));
    return { moves, crossLen: crossMoves.length };
  }

  function replay(seed: KPattern, physicalMoves: string[], relabel: boolean) {
    let pat = seed;
    let phase: CFOPPhase = 'cross';
    let slots: F2LSlotId[] = [];
    let crossDetectedAt = -1;
    const phasesSeen = new Set<string>();
    physicalMoves.forEach((m, i) => {
      pat = pat.applyAlg(new Alg(relabel ? relabelMoveZ2(m) : m));
      const snap = evaluateCFOPFromPattern(pat);
      if (crossDetectedAt < 0 && snap.isCrossSolved) crossDetectedAt = i + 1;
      const r = resolveMonotonicCFOPPhase(phase, slots, snap);
      phase = r.phase;
      slots = r.solvedSlots;
      phasesSeen.add(phase);
    });
    return { crossDetectedAt, finalPhase: phase, fullySolved: evaluateCFOPFromPattern(pat).isFullySolved, phasesSeen };
  }

  const SCRAMBLES = [
    "R U R' U' F' L2 D B2 U2 F2 R2 D' L2 U2 R2 D2 F2 D",
    "F R U' R' U' R U R' F' R U R' U' R' F R F'",
    "D2 B2 F2 R' D2 R' B2 R D2 R U2 F L' U' F' L2 D B2 D R2",
  ];

  for (const SCR of SCRAMBLES) {
    it(`tracks a CFOP solve for "${SCR.slice(0, 24)}…"`, async () => {
      const D = getDefaultPattern();
      // What a default-calibrated smart cube would read after a white-U scramble:
      const trueState = D.applyAlg(new Alg(SCR));
      // Tracker seed (== useCubeStore.setScramble output == trueState.applyAlg('z2')):
      const seed = D.applyAlg(new Alg(`${SCR} z2`));

      // A genuine cross-first CFOP solve, in the post-z2 frame the tracker works in:
      const { moves: cfopZ2, crossLen } = await realCfopSolvePostZ2(seed);
      // What the cube emits for that same physical solve (default/calibrated frame):
      const reported = cfopZ2.map(relabelMoveZ2);

      // Tracker approach: seed + relabel(reported) -> correct.
      const tracked = replay(seed, reported, /* relabel */ true);
      expect(tracked.fullySolved, 'tracker reaches solved').toBe(true);
      expect(tracked.crossDetectedAt, 'cross detected around the cross-move count')
        .toBeGreaterThan(0);
      expect(tracked.crossDetectedAt).toBeLessThanOrEqual(crossLen + 2);
      // F2L phases show up (at least one f2l-* split beyond cross).
      expect([...tracked.phasesSeen].some((p) => p.startsWith('f2l'))).toBe(true);

      // Raw approach (what was broken): true state + raw reported moves. Either never
      // detects the cross, or only right at the end — always far later than the tracker,
      // which is why "cross" used to swallow the whole solve.
      const raw = replay(trueState, reported, /* relabel */ false);
      const rawCross = raw.crossDetectedAt < 0 ? reported.length : raw.crossDetectedAt;
      expect(rawCross, 'raw frame detects cross far later than the tracker')
        .toBeGreaterThan(tracked.crossDetectedAt + 5);
    });
  }
});
