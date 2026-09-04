import type { KPattern } from 'cubing/kpuzzle';

/**
 * Same-situation loop guard for guided-solve hints.
 *
 * The worker remembers the last hint it handed out. If the *exact same* request
 * (same phase, slot, tier, notation and cube state) comes back and the matchers
 * would replay the identical sequence, that hint clearly didn't advance the
 * cube — so the worker escalates to the guaranteed full-solve fallback instead.
 *
 * The catch this guards against a regression of: a *deliberate* re-request — the
 * user changed the technique tier / notation mode, or tapped "Recalculate" —
 * also hits the same key, but there the user genuinely wants a fresh matcher
 * hint for the current state, **not** the fallback. For the cross phase the
 * fallback is especially wrong: the generic optimal solver doesn't build a CFOP
 * cross first, so its sliced "cross prefix" is very nearly the whole solve. Such
 * requests set `bypassLoopGuard` and skip the escalation entirely.
 */
export interface LastHint {
  key: string;
  moves: string;
}

export function hintKey(
  phase: string,
  activeSlot: string | undefined,
  tier: string,
  notationMode: string,
  pattern: KPattern
): string {
  const e = pattern.patternData.EDGES;
  const c = pattern.patternData.CORNERS;
  return `${phase}|${activeSlot ?? ''}|${tier}|${notationMode}|${e.pieces.join(',')}|${e.orientation.join(',')}|${c.pieces.join(',')}|${c.orientation.join(',')}`;
}

export function shouldForceFallback(
  lastHint: LastHint | null,
  key: string,
  bypassLoopGuard: boolean | undefined
): boolean {
  if (bypassLoopGuard) return false;
  return lastHint !== null && lastHint.key === key;
}
