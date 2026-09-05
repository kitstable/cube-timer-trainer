import { describe, it, expect, beforeEach } from 'vitest';
import { __scramblePartialGateForTests as gate } from '../hooks/useSmartCube';
import { useAppStore } from '../store/useAppStore';

/**
 * Regression coverage for the gate-lifecycle leak: `useSmartCube.ts`'s module-level
 * `scramblePartialGate` singleton is shared by Scramble and Training, and used to be reset
 * only on BLE connect/disconnect events — never when the tracked target itself changed (a
 * new scramble, a new training rep, a manual reset). A `partial` move held mid-grace-window
 * at the moment a new target was set would later commit against the *new* target's state,
 * producing a cue disconnected from anything the user actually did. `useSmartCube.ts` now
 * subscribes to `useAppStore` and resets the gate whenever `trackTargetMoves` or
 * `trackDoneMoves` changes for any reason other than the gate's own commit.
 */
describe('useSmartCube module-level gate lifecycle', () => {
  beforeEach(() => {
    gate.reset();
    useAppStore.setState({
      trackTargetMoves: [],
      trackRemainingMoves: [],
      trackDoneMoves: [],
      trackFeedback: null,
      trackCorrectionActive: false,
    });
  });

  it('drops a held partial when a new scramble target is set mid-grace-window', () => {
    useAppStore.getState().setTrackTarget(['L2', 'D', 'F2']);

    // First quarter-turn of the L2 — classifies `partial` and is held by the gate.
    gate.feed('L');
    expect(gate.hasHeld()).toBe(true);

    // A brand-new scramble starts before the second quarter-turn ever arrives.
    useAppStore.getState().setScramble("R U R'", ['R', 'U', "R'"]);
    expect(gate.hasHeld()).toBe(false);

    // The held `L` must never have been committed against the new target.
    expect(useAppStore.getState().trackDoneMoves).toEqual([]);
    expect(useAppStore.getState().trackTargetMoves).toEqual(['R', 'U', "R'"]);
  });

  it('drops a held partial on setTrackTarget (a new Training rep)', () => {
    useAppStore.getState().setTrackTarget(['R2', 'U', 'F2']);
    gate.feed('R');
    expect(gate.hasHeld()).toBe(true);

    useAppStore.getState().setTrackTarget(['D', "L'"]);
    expect(gate.hasHeld()).toBe(false);
    expect(useAppStore.getState().trackDoneMoves).toEqual([]);
  });

  it('drops a held partial on resetScrambleProgress / resetPhysicalTrack even though the target array is unchanged', () => {
    useAppStore.getState().setTrackTarget(['U2', 'D']);
    gate.feed('U');
    expect(gate.hasHeld()).toBe(true);

    useAppStore.getState().resetPhysicalTrack();
    expect(gate.hasHeld()).toBe(false);
    expect(useAppStore.getState().trackDoneMoves).toEqual([]);
  });

  it('does not drop a held partial on its own commit (the gate resolving a genuine double)', () => {
    useAppStore.getState().setTrackTarget(['L2', 'D', 'F2']);
    gate.feed('L');
    expect(gate.hasHeld()).toBe(true);

    // The second half of the same double — merges and commits normally through the gate,
    // which itself changes `trackDoneMoves`. This must not be treated as an external reset.
    gate.feed('L');
    expect(gate.hasHeld()).toBe(false);
    expect(useAppStore.getState().trackDoneMoves).toEqual(['L2']);
    expect(useAppStore.getState().trackRemainingMoves).toEqual(['D', 'F2']);
  });
});
