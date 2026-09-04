import { describe, it, expect, beforeAll } from 'vitest';
import { cube3x3x3 } from 'cubing/puzzles';
import { Alg } from 'cubing/alg';
import type { KPattern, KPuzzle } from 'cubing/kpuzzle';
import { CaseMatcher } from '../solver/caseMatcher';
import { findHint } from '../solver/findHint';
import { hintKey, shouldForceFallback, type LastHint } from '../solver/hintLoopGuard';
import algorithmData from '../data/cfop-algorithms.json';

// A cross that needs several moves — the case the reported bug showed up on.
const SCRAMBLE = "R U R' F' D2 L2 B2 U2 F2 D";

let kpuzzle: KPuzzle;
let matcher: CaseMatcher;
let pattern: KPattern;

beforeAll(async () => {
  kpuzzle = await cube3x3x3.kpuzzle();
  matcher = new CaseMatcher(kpuzzle);
  matcher.initialize(algorithmData as any);
  pattern = kpuzzle.defaultPattern().applyAlg(new Alg(`${SCRAMBLE} z2`));
});

describe('hint loop guard', () => {
  it('keys on tier + notation, so switching either is a different situation', () => {
    const a = hintKey('cross', undefined, '2look', 'simplified', pattern);
    const b = hintKey('cross', undefined, 'fullCFOP', 'simplified', pattern);
    const c = hintKey('cross', undefined, '2look', 'standard', pattern);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('escalates only on an identical repeat with no bypass', () => {
    const key = hintKey('cross', undefined, '2look', 'simplified', pattern);
    const last: LastHint = { key, moves: 'D2 F' };

    // Fresh situation / first ask — no escalation.
    expect(shouldForceFallback(null, key, false)).toBe(false);
    expect(shouldForceFallback({ key: 'other', moves: '' }, key, false)).toBe(false);
    // Identical repeat — escalate.
    expect(shouldForceFallback(last, key, false)).toBe(true);
    // Identical repeat but a deliberate re-request (tier/notation change,
    // Recalculate) — never escalate.
    expect(shouldForceFallback(last, key, true)).toBe(false);
  });

  it('a bypassed cross re-request stays a short cross, not a near-full solve', async () => {
    const normal = await findHint(matcher, pattern, { phase: 'cross', techniqueTier: '2look' }, false);
    // Simulate the loop guard firing (what a non-bypassed repeat would do).
    const escalated = await findHint(matcher, pattern, { phase: 'cross', techniqueTier: '2look' }, true);

    // Normal: a tight BFS white cross.
    expect(normal.caseName).toBe('White Cross');
    expect(normal.moves.length).toBeGreaterThan(0);
    expect(normal.moves.length).toBeLessThanOrEqual(8);
    // Escalated: the generic full-solve slice — a different, longer answer, which
    // is exactly why a deliberate re-request must bypass the guard, not trip it.
    expect(escalated.caseName).toBe('White Cross (computed)');
    expect(escalated.moves.length).toBeGreaterThan(normal.moves.length);
  });
});
