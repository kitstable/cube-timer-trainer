import { describe, it, expect, beforeAll } from 'vitest';
import { cube3x3x3 } from 'cubing/puzzles';
import { Alg } from 'cubing/alg';
import { CaseMatcher } from '../solver/caseMatcher';
import { generateCaseScramble } from '../solver/trainingScrambleGenerator';
import { relabelMoveZ2 } from '../utils/kpuzzleHelper';
import {
  buildTwoLookDrills,
  drillPredicate,
  solveWithAlgSet,
  isYellowCrossSolved,
  areTopCornersPlaced,
  isSolvedUpToAuf,
  type TwoLookDrillId,
} from '../solver/twoLook';
import { isOLLSolved } from '../solver/cfopInvariants';
import algorithmData from '../data/cfop-algorithms.json';

const DRILLS = buildTwoLookDrills(algorithmData as any);
const DRILL_IDS = Object.keys(DRILLS) as TwoLookDrillId[];

describe('2-Look drills', () => {
  let matcher: CaseMatcher;
  let solvedPostZ2: any;

  beforeAll(async () => {
    const kp = await cube3x3x3.kpuzzle();
    matcher = new CaseMatcher(kp);
    matcher.initialize(algorithmData as any);
    solvedPostZ2 = matcher.getSolvedPostZ2();
  });

  it('drill alg strings stay in sync with the dataset', () => {
    const raw = (list: any[], name: string) => list.find((e) => e.name === name)?.algorithm;
    expect(DRILLS['oll-corners'].algs).toEqual([
      { label: 'Sune', alg: raw(algorithmData.OLL, 'OLL-27 Sune') },
      { label: 'Anti-Sune', alg: raw(algorithmData.OLL, 'OLL-26 Anti Sune') },
    ]);
    expect(DRILLS['pll-edges'].algs.map((a) => a.alg)).toEqual([
      raw(algorithmData.PLL, 'Ua Perm'),
      raw(algorithmData.PLL, 'Ub Perm'),
      raw(algorithmData.PLL, 'H Perm'),
      raw(algorithmData.PLL, 'Z Perm'),
    ]);
    // oll-corners pool is exactly the 7 "yellow cross solved" cases.
    expect(DRILLS['oll-corners'].caseNames.sort()).toEqual(
      algorithmData.OLL.filter((e: any) => e.subset === 'Oriented Edges').map((e: any) => e.name).sort()
    );
  });

  it('every corner case is solvable by a Sune / Anti-Sune combination', async () => {
    const drill = DRILLS['oll-corners'];
    for (const name of drill.caseNames) {
      const target = matcher.getCases('OLL').find((c) => c.name === name)!;
      const scramble = await generateCaseScramble(solvedPostZ2, target, { randomisePermutation: false });
      const atCase = solvedPostZ2.applyAlg(new Alg(scramble.join(' ')));

      expect(isYellowCrossSolved(atCase), `${name}: yellow cross should already be made`).toBe(true);
      expect(isOLLSolved(atCase), `${name}: corners not yet oriented`).toBe(false);

      const combo = solveWithAlgSet(atCase, drill.algs, drillPredicate('oll-corners'), 4);
      expect(combo, `${name}: no Sune/Anti-Sune combo found`).not.toBeNull();

      let p = atCase;
      for (const step of combo!) p = p.applyAlg(new Alg(step.alg));
      expect(isOLLSolved(p), `${name}: combo ${combo!.map((s) => s.label).join(' + ')} should orient corners`).toBe(
        true
      );
    }
  }, 60_000);

  it('each drill: scramble lands on the drill start-state, and its alg set solves it', async () => {
    for (const id of DRILL_IDS) {
      const drill = DRILLS[id];
      const pool =
        drill.caseSource === 'OLL_2LOOK_EDGE' ? matcher.getTwoLookEdgeCases() : matcher.getCases(drill.caseSource);
      const isDone = drillPredicate(id);

      for (const caseName of drill.caseNames) {
        const target = pool.find((c) => c.name === caseName || c.name.endsWith(caseName))!;
        expect(target, `${id}: missing case ${caseName}`).toBeTruthy();
        const scramble = await generateCaseScramble(solvedPostZ2, target, { randomisePermutation: false });
        const atCase = solvedPostZ2.applyAlg(new Alg(scramble.join(' ')));

        expect(isDone(atCase), `${id}/${caseName}: should NOT already satisfy the goal`).toBe(false);

        const combo = solveWithAlgSet(atCase, drill.algs, isDone, 5);
        expect(combo, `${id}/${caseName}: alg set can't reach the goal`).not.toBeNull();
      }
    }
  }, 120_000);

  it('predicates: yellow cross / corners placed / solved-up-to-AUF', async () => {
    // Yellow cross: solved cube minus an edge flip pair is NOT a cross; solved IS.
    expect(isYellowCrossSolved(solvedPostZ2)).toBe(true);
    expect(areTopCornersPlaced(solvedPostZ2)).toBe(true);
    expect(isSolvedUpToAuf(solvedPostZ2)).toBe(true);
    // A U turn keeps "solved up to AUF" true but breaks strict full-solve.
    const auf = solvedPostZ2.applyAlg(new Alg('U'));
    expect(isSolvedUpToAuf(auf)).toBe(true);
    // Sune from solved: corners twisted -> not OLL, but F2L + edges still fine.
    const sune = solvedPostZ2.applyAlg(new Alg("R U R' U R U2' R'"));
    expect(isOLLSolved(sune)).toBe(false);
    expect(isYellowCrossSolved(sune)).toBe(true);
  });

  it('a raw-frame corner scramble + Sune/Anti-Sune combo reads solved via `pattern · z2`', async () => {
    // Mirrors TrainingView connected completion: raw scramble from solved, combo in raw frame.
    const kp = await cube3x3x3.kpuzzle();
    const drill = DRILLS['oll-corners'];
    for (const name of drill.caseNames.slice(0, 4)) {
      const target = matcher.getCases('OLL').find((c) => c.name === name)!;
      const raw = (await generateCaseScramble(solvedPostZ2, target, { randomisePermutation: false })).map(relabelMoveZ2);
      let p = kp.defaultPattern().applyAlg(new Alg(raw.join(' ')));
      const combo = solveWithAlgSet(p.applyAlg(new Alg('z2')), drill.algs, drillPredicate('oll-corners'), 4)!;
      for (const step of combo) p = p.applyAlg(new Alg(step.alg.split(' ').map(relabelMoveZ2).join(' ')));
      expect(isOLLSolved(p.applyAlg(new Alg('z2'))), `${name}`).toBe(true);
    }
  }, 60_000);
});
