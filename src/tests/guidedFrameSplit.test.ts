import { describe, it, expect } from 'vitest';
import { guidedPlanMoves, guidedFeedMoveFrame, relabelMoveZ2 } from '../utils/kpuzzleHelper';

/**
 * Connected Guided Solve's target-frame split (`GuidedSolveView.tsx`'s `fetchHintForCurrentPhase`
 * + `useSmartCube.ts`'s BLE listener) has two halves that must always agree: which frame the
 * tracked target (`trackTargetMoves`) is expressed in, and which frame an incoming physical turn
 * gets relabelled to before it reaches the classifier. Getting one half right without the other
 * silently misclassifies every turn — the exact "plausible-looking but wrong, silently" z2
 * failure mode this repo's other z2 code has hit before (see CLAUDE.md).
 *
 * The property under test: for a post-z2 hint move `planTok`, the raw physical turn a user
 * makes to execute it is always `relabelMoveZ2(planTok)` (the cube reports raw-frame turns
 * regardless of any display preference) — and whichever frame `guidedPlanMoves` puts the
 * target in, `guidedFeedMoveFrame` applied to that same raw turn must land on that exact
 * target token.
 */
describe('Guided Solve target-frame split (guidedPlanMoves / guidedFeedMoveFrame)', () => {
  const POST_Z2_SAMPLE = ["R", "U'", 'F2', 'L', "D'", 'B', 'R2', "U2"];

  it('yellow-up off: target is relabelled to raw, and the raw physical turn is fed unchanged', () => {
    for (const planTok of POST_Z2_SAMPLE) {
      const target = guidedPlanMoves([planTok], false)[0];
      expect(target).toBe(relabelMoveZ2(planTok));

      const rawPhysicalTurn = relabelMoveZ2(planTok); // what the cube always reports
      const seenByClassifier = guidedFeedMoveFrame(rawPhysicalTurn, false);
      expect(seenByClassifier).toBe(target);
    }
  });

  it('yellow-up on: target stays post-z2, and the raw physical turn is relabelled to match', () => {
    for (const planTok of POST_Z2_SAMPLE) {
      const target = guidedPlanMoves([planTok], true)[0];
      expect(target).toBe(planTok); // unrelabelled

      const rawPhysicalTurn = relabelMoveZ2(planTok); // same physical action, same raw reading
      const seenByClassifier = guidedFeedMoveFrame(rawPhysicalTurn, true);
      expect(seenByClassifier).toBe(target);
    }
  });

  it('the two halves disagree if only one is toggled (guards against a partial fix)', () => {
    const planTok = "R'";
    const rawPhysicalTurn = relabelMoveZ2(planTok);

    // Target built for yellow-up ON, but the incoming move relabelled as if it were OFF:
    const target = guidedPlanMoves([planTok], true)[0];
    const wronglyFedMove = guidedFeedMoveFrame(rawPhysicalTurn, false);
    expect(wronglyFedMove).not.toBe(target);
  });
});
