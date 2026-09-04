/**
 * Guided-scramble partial-turn deferral gate (pure, dependency-injected).
 *
 * A physical double turn (`R2`) reaches the app as two separate `R` quarter-turn events —
 * GAN / QiYi protocols never emit doubles. Fed straight to the tracker, the first `R`
 * classifies as a `partial` and the guide immediately flips the next-move badge to `R`,
 * rings the cube amber and shows a correction chip — all of which vanish tens of ms later
 * when the second `R` lands.
 *
 * This gate sits between the BLE move event and `applyPhysicalTrackMove`. When a turn
 * would classify as `partial` it is *held* for `graceMs`. If a second turn arrives first
 * on the *same face* (the real shape of a double turn — `R` then `R` for an `R2`), the two
 * are **merged** and processed as one move (`R2`), so the guide never briefly shows the
 * double as "one done, one to go" and never flashes the amber cue mid-double. A same-face
 * pair that cancels (`R` then `R'`) is dropped as a no-op wobble. If the second turn is on
 * a different face the held one was a genuine mid-face stop: it is committed (raising its
 * cue) and the new turn processed after it. If the grace timer fires with the move still
 * held, it is committed for the same reason.
 *
 * `progress` / `complete` / `error` / `ignored` are never deferred — a wrong-face turn
 * still corrects instantly.
 *
 * No import of the store or `cubing`: `classify` and `commit` are injected so this is
 * unit-testable with fake timers, the way `syncPatternAndRoute` injects its deps.
 * `simplifyMoveSequence` / `sameFace` are pure string algebra (no `cubing`), same as the
 * tracker this feeds.
 */

import type { ScrambleMoveKind } from './scrambleTracker';
import { simplifyMoveSequence, sameFace } from './moveSimplifier';

export interface ScramblePartialGateDeps {
  /** Classify a turn against the current tracker state (kind is all the gate needs). */
  classify: (move: string) => ScrambleMoveKind;
  /** Commit a turn to the tracker (`applyPhysicalTrackMove`). */
  commit: (move: string) => void;
  /** Grace window in ms to wait for a second quarter-turn before showing a partial. */
  graceMs: number;
  /** Injected for tests; defaults to the globals. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface ScramblePartialGate {
  /** Feed one physical face turn. */
  feed: (move: string) => void;
  /** Commit any held move immediately (e.g. on tab change). */
  flush: () => void;
  /** Drop any held move without committing (e.g. on disconnect / scramble reset). */
  reset: () => void;
  /** True while a `partial` turn is being held for its grace window. */
  hasHeld: () => boolean;
}

export function createScramblePartialGate(deps: ScramblePartialGateDeps): ScramblePartialGate {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h));

  let heldMove: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const flush = () => {
    cancelTimer();
    if (heldMove !== null) {
      const m = heldMove;
      heldMove = null;
      deps.commit(m);
    }
  };

  const reset = () => {
    cancelTimer();
    heldMove = null;
  };

  /** Classify `move` against the current tracker state and either commit it or hold it. */
  const process = (move: string) => {
    const kind = deps.classify(move);
    if (kind === 'partial') {
      heldMove = move;
      timer = setTimer(() => {
        timer = null;
        const m = heldMove;
        heldMove = null;
        if (m !== null) deps.commit(m);
      }, deps.graceMs);
      return;
    }
    deps.commit(move);
  };

  const feed = (move: string) => {
    if (heldMove !== null) {
      const held = heldMove;
      cancelTimer();
      heldMove = null;

      if (sameFace(held, move)) {
        // The real shape of a double turn: two quarter-turns on one face. Merge and
        // process once so the double never flashes the half-turn cue or briefly reads as
        // "one done, one to go".
        const merged = simplifyMoveSequence([held, move]);
        if (merged.length === 0) return; // `R` then `R'` — turned straight back, a no-op
        if (merged.length === 1) {
          process(merged[0]);
          return;
        }
        // Same-face pair always merges to 0 or 1 tokens; this is unreachable, but stay safe.
        deps.commit(held);
        process(move);
        return;
      }

      // Different face — the held turn was a genuine mid-face stop. Surface it, then this.
      deps.commit(held);
    }

    process(move);
  };

  return { feed, flush, reset, hasHeld: () => heldMove !== null };
}
