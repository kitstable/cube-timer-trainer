/**
 * Guided-scramble partial-turn deferral gate (pure, dependency-injected).
 *
 * A physical double turn (`R2`) reaches the app as two separate `R` quarter-turn events —
 * GAN / QiYi protocols never emit doubles. Fed straight to the tracker, the first `R`
 * classifies as a `partial` and the guide immediately flips the next-move badge to `R`,
 * rings the cube amber and shows a correction chip — all of which vanish tens of ms later
 * when the second `R` lands.
 *
 * This gate sits between the BLE move event and `applyPhysicalScrambleMove`. When a turn
 * would classify as `partial` it is *held* for `graceMs`; if a second turn arrives first
 * the held move is committed and the new one processed normally (a fluid double turn then
 * resolves to `progress` with no amber frame). If the grace timer fires with the move
 * still held, it is committed — the user genuinely stopped mid-face and should see the
 * "keep turning this face" cue.
 *
 * `progress` / `complete` / `error` / `ignored` are never deferred — a wrong-face turn
 * still corrects instantly.
 *
 * No import of the store or `cubing`: `classify` and `commit` are injected so this is
 * unit-testable with fake timers, the way `syncPatternAndRoute` injects its deps.
 */

import type { ScrambleMoveKind } from './scrambleTracker';

export interface ScramblePartialGateDeps {
  /** Classify a turn against the current tracker state (kind is all the gate needs). */
  classify: (move: string) => ScrambleMoveKind;
  /** Commit a turn to the tracker (`applyPhysicalScrambleMove`). */
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

  const feed = (move: string) => {
    // A move is already held: a second turn arrived within the grace window. Commit the
    // held one, then handle this turn from the (now-updated) state.
    if (heldMove !== null) {
      flush();
    }

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

  return { feed, flush, reset };
}
