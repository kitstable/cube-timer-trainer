import { describe, it, expect, beforeAll } from 'vitest';
import { cube3x3x3 } from 'cubing/puzzles';
import { Alg } from 'cubing/alg';
import type { KPattern, KPuzzle } from 'cubing/kpuzzle';
import { CaseMatcher } from '../solver/caseMatcher';
import { findHint } from '../solver/findHint';
import { evaluateCFOPFromPattern } from '../utils/phaseDetector';
import { ALL_F2L_SLOTS } from '../solver/cfopInvariants';
import algorithmData from '../data/cfop-algorithms.json';
import type { TechniqueTier, NotationMode } from '../types/cube';

// ---- tiny seeded PRNG + scramble generator (deterministic across runs) ----
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const FACES = ['U', 'D', 'L', 'R', 'F', 'B'];
const SUFFIX = ['', "'", '2'];
function scramble(rand: () => number, len = 25): string {
  const moves: string[] = [];
  let last = '';
  for (let i = 0; i < len; i++) {
    let f = FACES[Math.floor(rand() * 6)];
    while (f === last) f = FACES[Math.floor(rand() * 6)];
    last = f;
    moves.push(f + SUFFIX[Math.floor(rand() * 3)]);
  }
  return moves.join(' ');
}

let kpuzzle: KPuzzle;
let matcher: CaseMatcher;

beforeAll(async () => {
  kpuzzle = await cube3x3x3.kpuzzle();
  matcher = new CaseMatcher(kpuzzle);
  matcher.initialize(algorithmData as any);
});

interface RunResult {
  solved: boolean;
  hints: number;
  computedHints: number;
  stuckAt?: string;
}

async function runGuidedSolve(
  scr: string,
  tier: TechniqueTier,
  notation: NotationMode,
  forceFallback = false
): Promise<RunResult> {
  let pattern: KPattern = kpuzzle.defaultPattern().applyAlg(new Alg(`${scr} z2`));
  let hints = 0;
  let computedHints = 0;

  for (let step = 0; step < 80; step++) {
    const status = evaluateCFOPFromPattern(pattern);
    if (status.isFullySolved) return { solved: true, hints, computedHints };

    const phase = status.currentPhase === 'solved' ? 'pll' : status.currentPhase;
    const activeSlot = ALL_F2L_SLOTS.find((s) => !status.solvedSlots.includes(s));

    const hint = await findHint(
      matcher,
      pattern,
      { phase, activeSlot, techniqueTier: tier, notationMode: notation },
      forceFallback
    );
    hints++;
    if (/\(computed\)/.test(hint.caseName)) computedHints++;

    if (hint.moves.length === 0) {
      // Only acceptable if we're actually solved.
      if (evaluateCFOPFromPattern(pattern).isFullySolved) return { solved: true, hints, computedHints };
      const E = pattern.patternData.EDGES, C = pattern.patternData.CORNERS;
      return {
        solved: false,
        hints,
        computedHints,
        stuckAt:
          `${phase} empty="${hint.caseName}" oll=${status.isOLLSolved} pll=${status.isPLLSolved} ` +
          `Eori=[${E.orientation}] Cori=[${C.orientation}] Ep=[${E.pieces}] Cp=[${C.pieces}]`,
      };
    }

    const before = pattern;
    for (const m of hint.moves) pattern = pattern.applyAlg(new Alg(m));

    // must make some progress on the cube state
    if (patternsEqual(before, pattern)) {
      return { solved: false, hints, computedHints, stuckAt: `${phase} (no-op hint: ${hint.caseName})` };
    }
  }
  return { solved: false, hints, computedHints, stuckAt: `hint cap (last phase progress stalled)` };
}

function patternsEqual(a: KPattern, b: KPattern): boolean {
  const ae = a.patternData.EDGES, be = b.patternData.EDGES;
  const ac = a.patternData.CORNERS, bc = b.patternData.CORNERS;
  return (
    ae.pieces.every((v: number, i: number) => v === be.pieces[i]) &&
    ae.orientation.every((v: number, i: number) => v === be.orientation[i]) &&
    ac.pieces.every((v: number, i: number) => v === bc.pieces[i]) &&
    ac.orientation.every((v: number, i: number) => v === bc.orientation[i])
  );
}

const TIERS: TechniqueTier[] = ['2look', 'fullPLL', 'fullCFOP'];
const NOTATIONS: NotationMode[] = ['simplified', 'standard'];

describe('Guided solve converges for every scramble / tier / notation', () => {
  for (const tier of TIERS) {
    for (const notation of NOTATIONS) {
      it(`${tier} + ${notation}: 12 random scrambles all reach solved`, async () => {
        const rand = mulberry32(0xC0FFEE + tier.length * 7 + notation.length);
        let totalHints = 0;
        let totalComputed = 0;
        for (let i = 0; i < 12; i++) {
          const scr = scramble(rand);
          const res = await runGuidedSolve(scr, tier, notation);
          expect(res.solved, `scramble "${scr}" stuck at ${res.stuckAt}`).toBe(true);
          totalHints += res.hints;
          totalComputed += res.computedHints;
        }
        // The dedicated case matchers should do the vast majority of the work;
        // the guaranteed full-solve fallback is a backstop, not the main path.
        expect(totalComputed / totalHints).toBeLessThan(0.15);
      }, 60_000);
    }
  }

  it('connected-cube path: hint read from `physicalPattern · z2` converges', async () => {
    // The rewritten GuidedSolveView feeds `findHint` the live cube via
    // `physicalPattern.applyAlg('z2')`. `physicalPattern` is the raw smart-cube frame
    // (`defaultPattern · physical turns`); this loop mirrors that bridge exactly.
    const { relabelMoveZ2 } = await import('../utils/kpuzzleHelper');
    const rand = mulberry32(0xBADCAB);
    for (let i = 0; i < 8; i++) {
      const scr = scramble(rand);
      let physical = kpuzzle.defaultPattern().applyAlg(new Alg(scr)); // raw frame
      let solved = false;
      for (let step = 0; step < 80 && !solved; step++) {
        const hintPattern = physical.applyAlg(new Alg('z2')); // -> post-z2, what findHint reads
        const status = evaluateCFOPFromPattern(hintPattern);
        if (status.isFullySolved) {
          solved = true;
          break;
        }
        const phase = status.currentPhase === 'solved' ? 'pll' : status.currentPhase;
        const activeSlot = ALL_F2L_SLOTS.find((s) => !status.solvedSlots.includes(s));
        const hint = await findHint(
          matcher,
          hintPattern,
          { phase, activeSlot, techniqueTier: '2look', notationMode: 'simplified' },
          false
        );
        expect(hint.moves.length, `scramble "${scr}" empty hint in ${phase}`).toBeGreaterThan(0);
        // The smart cube reports turns in its calibrated (raw) frame — relabel each
        // post-z2 hint move back before advancing the physical model.
        for (const m of hint.moves) physical = physical.applyAlg(new Alg(relabelMoveZ2(m)));
      }
      expect(solved, `scramble "${scr}" did not converge via the connected frame`).toBe(true);
    }
  }, 60_000);

  it('connected walkthrough: physical turns tick through the hint, then complete', async () => {
    // The rewritten connected Guided view feeds each hint (relabelled to the raw frame) into
    // `classifyScrambleMove` and advances a move at a time; a `complete` recomputes the next.
    const { relabelMoveZ2 } = await import('../utils/kpuzzleHelper');
    const { classifyScrambleMove } = await import('../utils/scrambleTracker');
    const rand = mulberry32(0xF01);
    for (let i = 0; i < 6; i++) {
      const scr = scramble(rand);
      let physical = kpuzzle.defaultPattern().applyAlg(new Alg(scr));
      let steps = 0;
      let solved = false;
      for (let phaseIter = 0; phaseIter < 20 && !solved; phaseIter++) {
        const hp = physical.applyAlg(new Alg('z2'));
        const status = evaluateCFOPFromPattern(hp);
        if (status.isFullySolved) {
          solved = true;
          break;
        }
        const phase = status.currentPhase === 'solved' ? 'pll' : status.currentPhase;
        const slot = ALL_F2L_SLOTS.find((s) => !status.solvedSlots.includes(s));
        const hint = await findHint(matcher, hp, { phase, activeSlot: slot, techniqueTier: '2look', notationMode: 'simplified' }, false);
        const plan = hint.moves.map(relabelMoveZ2);
        expect(plan.length, `${scr}: empty hint in ${phase}`).toBeGreaterThan(0);

        const done: string[] = [];
        let correction = false;
        for (const mv of plan) {
          const cls = classifyScrambleMove(plan, done, mv, correction);
          steps++;
          // Executing the plan verbatim must never read as a wrong turn.
          expect(cls.kind, `${scr}: ${phase} plan move ${mv} classified ${cls.kind}`).not.toBe('error');
          done.splice(0, done.length, ...cls.nextDone);
          correction = cls.correctionActive;
          physical = physical.applyAlg(new Alg(mv)); // `mv` is already in the raw frame
        }
        // After the whole plan, the tracker should have said `complete` on the last move.
        const last = classifyScrambleMove(plan, plan.slice(0, -1), plan[plan.length - 1], false);
        expect(last.kind, `${scr}: ${phase} plan did not complete`).toBe('complete');
      }
      expect(solved, `${scr}: walkthrough did not reach solved (steps=${steps})`).toBe(true);
    }
  }, 60_000);

  it('the guaranteed fallback alone (no matchers) still solves every scramble', async () => {
    const rand = mulberry32(0x5A17);
    for (let i = 0; i < 8; i++) {
      const scr = scramble(rand);
      const res = await runGuidedSolve(scr, 'fullCFOP', 'simplified', /* forceFallback */ true);
      expect(res.solved, `scramble "${scr}" stuck at ${res.stuckAt}`).toBe(true);
      // every non-terminal hint came from the guaranteed fallback
      expect(res.computedHints).toBeGreaterThanOrEqual(res.hints - 1);
    }
  }, 60_000);
});
