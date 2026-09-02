import { describe, it, expect, beforeAll } from 'vitest';
import { cube3x3x3 } from 'cubing/puzzles';
import { Alg } from 'cubing/alg';
import { CaseMatcher } from '../solver/caseMatcher';
import { generateCaseScramble } from '../solver/trainingScrambleGenerator';
import { relabelMoveZ2, getKPuzzle, getPostZ2Pattern } from '../utils/kpuzzleHelper';
import { isOLLSolved, isFullySolved } from '../solver/cfopInvariants';
import algorithmData from '../data/cfop-algorithms.json';

/**
 * Correctness test per training-mode-spec §5: apply the generated scramble to a solved
 * cube, then run the *production* case matcher against the result and assert it identifies
 * the case we asked for. The matcher is the same oracle Training mode uses for completion
 * detection, so this tests the real thing rather than "does the known alg solve it".
 */
describe('Training scramble generator', () => {
  let matcher: CaseMatcher;
  let solvedPostZ2: any;
  let pllPool: ReturnType<CaseMatcher['getCases']>;

  beforeAll(async () => {
    const kp = await cube3x3x3.kpuzzle();
    matcher = new CaseMatcher(kp);
    matcher.initialize(algorithmData as any);
    solvedPostZ2 = matcher.getSolvedPostZ2();
    pllPool = matcher.getCases('PLL');
  });

  it('every OLL case scramble lands on that OLL case (matchOLL oracle)', async () => {
    const cases = matcher.getCases('OLL');
    for (const c of cases) {
      const scramble = await generateCaseScramble(solvedPostZ2, c, {
        randomisePermutation: false,
      });
      expect(scramble.length).toBeGreaterThan(0);
      const state = solvedPostZ2.applyAlg(new Alg(scramble.join(' ')));
      const match = matcher.matchOLL(state);
      expect(match, `OLL case "${c.name}" scramble ${scramble.join(' ')}`).not.toBeNull();
      expect(match?.caseName, `OLL case "${c.name}"`).toBe(c.name);
    }
  }, 60_000);

  it('every PLL case scramble lands on that PLL case (matchPLL oracle)', async () => {
    const cases = matcher.getCases('PLL');
    for (const c of cases) {
      const scramble = await generateCaseScramble(solvedPostZ2, c, {
        randomisePermutation: false,
      });
      expect(scramble.length).toBeGreaterThan(0);
      const state = solvedPostZ2.applyAlg(new Alg(scramble.join(' ')));
      const match = matcher.matchPLL(state);
      expect(match, `PLL case "${c.name}" scramble ${scramble.join(' ')}`).not.toBeNull();
      expect(match?.caseName, `PLL case "${c.name}"`).toBe(c.name);
    }
  }, 60_000);

  it('TrainingView completion path: raw-frame scramble, solve, `pattern · z2` reads as solved', async () => {
    // Mirrors TrainingView exactly: the generated (post-z2) scramble is relabelled to the
    // raw smart-cube frame and applied from a solved `defaultPattern`; the solving moves
    // (whatever a solver hands the user, AUF included) are also applied in the raw frame;
    // completion is checked as `isOLLSolved(pattern · z2)`.
    const kp = await cube3x3x3.kpuzzle();
    const defaultPattern = kp.defaultPattern();
    const applyRaw = (p: any, moves: string[]) => (moves.length ? p.applyAlg(new Alg(moves.join(' '))) : p);
    const z2 = (p: any) => p.applyAlg(new Alg('z2'));

    for (const c of matcher.getCases('OLL').slice(0, 12)) {
      const rawScramble = (await generateCaseScramble(solvedPostZ2, c, { randomisePermutation: false })).map(
        relabelMoveZ2
      );
      const atCase = applyRaw(defaultPattern, rawScramble);
      expect(isOLLSolved(z2(atCase)), `${c.name} not yet OLL-solved`).toBe(false);

      // What a solver would hand the user (post-z2 frame, AUF included) -> raw frame.
      const solvePostZ2 = matcher.matchOLL(z2(atCase))!.moves;
      const afterSolve = applyRaw(atCase, solvePostZ2.map(relabelMoveZ2));
      expect(isOLLSolved(z2(afterSolve)), `${c.name} OLL solved after the solver's moves`).toBe(true);
    }

    for (const c of matcher.getCases('PLL').slice(0, 8)) {
      const rawScramble = (await generateCaseScramble(solvedPostZ2, c, { randomisePermutation: false })).map(
        relabelMoveZ2
      );
      const atCase = applyRaw(defaultPattern, rawScramble);
      const solvePostZ2 = matcher.matchPLL(z2(atCase))!.moves;
      const afterSolve = applyRaw(atCase, solvePostZ2.map(relabelMoveZ2));
      expect(isFullySolved(z2(afterSolve)), `${c.name} fully solved after the solver's moves`).toBe(true);
    }
  }, 60_000);

  it('TrainingView no-cube path: post-z2 scramble + post-z2 solution, no extra z2', async () => {
    // Mirrors the no-cube keypad path: `attemptPattern` is seeded from `getPostZ2Pattern()`,
    // advanced by post-z2 taps, and fed to the completion check DIRECTLY (no `· z2`).
    await getKPuzzle();
    const applyPZ = (p: any, moves: string[]) => (moves.length ? p.applyAlg(new Alg(moves.join(' '))) : p);

    for (const c of matcher.getCases('OLL').slice(0, 10)) {
      const scramblePostZ2 = await generateCaseScramble(solvedPostZ2, c, { randomisePermutation: false });
      const atCase = applyPZ(getPostZ2Pattern(), scramblePostZ2);
      expect(isOLLSolved(atCase), `${c.name} not yet OLL-solved`).toBe(false);
      const solved = applyPZ(atCase, matcher.matchOLL(atCase)!.moves);
      expect(isOLLSolved(solved), `${c.name} OLL solved (no-cube frame)`).toBe(true);
    }

    for (const c of matcher.getCases('PLL').slice(0, 6)) {
      const scramblePostZ2 = await generateCaseScramble(solvedPostZ2, c, { randomisePermutation: false });
      const atCase = applyPZ(getPostZ2Pattern(), scramblePostZ2);
      const solved = applyPZ(atCase, matcher.matchPLL(atCase)!.moves);
      expect(isFullySolved(solved), `${c.name} fully solved (no-cube frame)`).toBe(true);
    }
  }, 60_000);

  it('the same OLL case drilled repeatedly produces more than one scramble (AUF variety)', async () => {
    const sune = matcher.getCases('OLL').find((c) => /Sune/.test(c.name) && !/Anti/.test(c.name))!;
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const s = await generateCaseScramble(solvedPostZ2, sune, { randomisePermutation: false });
      seen.add(s.join(' '));
    }
    expect(seen.size).toBeGreaterThan(1);
  }, 30_000);

  it('F2L drill: scramble is attempt-ready and its solution passes isSlotSolved + preservesProgress', async () => {
    const { isSlotSolved, preservesProgress } = await import('../solver/cfopInvariants');
    const f2lCases = matcher.getCases('F2L');
    const bySlot = new Map<string, (typeof f2lCases)[number][]>();
    for (const c of f2lCases) {
      if (!c.targetSlot) continue;
      (bySlot.get(c.targetSlot) ?? bySlot.set(c.targetSlot, []).get(c.targetSlot)!).push(c);
    }
    for (const [slot, cases] of bySlot) {
      for (const c of cases.slice(0, 4)) {
        const scramble = await generateCaseScramble(solvedPostZ2, c, { randomisePermutation: true, pllPool });
        const start = solvedPostZ2.applyAlg(new Alg(scramble.join(' ')));
        expect(isSlotSolved(start, slot as any), `${c.name}: slot not yet solved`).toBe(false);

        const solution = matcher.matchF2L(start, slot)!.moves;
        const solved = start.applyAlg(new Alg(solution.join(' ')));
        expect(isSlotSolved(solved, slot as any), `${c.name}: slot solved after matchF2L`).toBe(true);
        expect(preservesProgress(start, solved), `${c.name}: rest of F2L preserved`).toBe(true);
      }
    }
  }, 120_000);

  it('Cross drill: a WCA scramble + its BFS cross solution reads as cross-solved', async () => {
    const { randomScrambleForEvent } = await import('cubing/scramble');
    const { solveCrossBFS } = await import('../solver/crossBfs');
    const { isCrossSolved } = await import('../solver/cfopInvariants');
    const { relabelMoveZ2 } = await import('../utils/kpuzzleHelper');
    const kp = await cube3x3x3.kpuzzle();

    for (let i = 0; i < 6; i++) {
      const wca = (await randomScrambleForEvent('333')).toString();
      // No-cube cross path: white-up default frame + raw scramble; check on `pattern · z2`.
      const start = kp.defaultPattern().applyAlg(new Alg(wca));
      const postZ2 = start.applyAlg(new Alg('z2'));
      expect(isCrossSolved(postZ2), `scramble ${i}: cross not yet solved`).toBe(false);

      const crossPostZ2 = solveCrossBFS(postZ2, 8);
      // The drill applies the hint relabelled into the white-up frame.
      const solved = start.applyAlg(new Alg(crossPostZ2.map(relabelMoveZ2).join(' ')));
      expect(isCrossSolved(solved.applyAlg(new Alg('z2'))), `scramble ${i}: cross solved`).toBe(true);
    }
  }, 60_000);
});
