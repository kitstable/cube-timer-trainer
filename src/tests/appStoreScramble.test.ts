import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store/useAppStore';

const S = ["L'", 'D', 'F2'];

function reset() {
  useAppStore.setState({
    currentScramble: '',
    scrambleMoves: [],
    scrambleProgressIndex: 0,
    trackTargetMoves: [],
    trackRemainingMoves: [],
    trackDoneMoves: [],
    trackFeedback: null,
    trackCorrectionActive: false,
  });
}

describe('useAppStore — physical move-sequence tracking', () => {
  beforeEach(reset);

  it('setScramble seeds the tracker fields', () => {
    useAppStore.getState().setScramble("L' D F2", S);
    const s = useAppStore.getState();
    expect(s.trackTargetMoves).toEqual(S);
    expect(s.trackRemainingMoves).toEqual(S);
    expect(s.trackDoneMoves).toEqual([]);
    expect(s.trackFeedback).toBeNull();
    expect(s.trackCorrectionActive).toBe(false);
  });

  it('setTrackTarget seeds the tracker without touching the Scramble-tab scramble', () => {
    useAppStore.getState().setTrackTarget(S);
    const s = useAppStore.getState();
    expect(s.trackTargetMoves).toEqual(S);
    expect(s.trackRemainingMoves).toEqual(S);
    expect(s.currentScramble).toBe('');
    expect(s.scrambleMoves).toEqual([]);
  });

  it('a correct run advances remaining and never raises feedback', () => {
    useAppStore.getState().setScramble("L' D F2", S);
    for (const m of S) useAppStore.getState().applyPhysicalTrackMove(m);
    const s = useAppStore.getState();
    expect(s.trackRemainingMoves).toEqual([]);
    expect(s.trackFeedback).toBeNull();
    expect(s.trackDoneMoves).toEqual(S);
  });

  it('a wrong turn raises error feedback, which clears on the correcting turn', () => {
    useAppStore.getState().setScramble("L' D F2", S);
    useAppStore.getState().applyPhysicalTrackMove('R');
    let s = useAppStore.getState();
    expect(s.trackFeedback?.kind).toBe('error');
    expect(s.trackFeedback?.corrections).toEqual(["R'"]);
    expect(s.trackRemainingMoves).toEqual(["R'", "L'", 'D', 'F2']);

    useAppStore.getState().applyPhysicalTrackMove("R'");
    s = useAppStore.getState();
    expect(s.trackFeedback).toBeNull();
    expect(s.trackCorrectionActive).toBe(false);
    expect(s.trackRemainingMoves).toEqual(S);
  });

  it('a rotation is ignored and leaves state untouched', () => {
    useAppStore.getState().setScramble("L' D F2", S);
    useAppStore.getState().applyPhysicalTrackMove('y');
    const s = useAppStore.getState();
    expect(s.trackDoneMoves).toEqual([]);
    expect(s.trackRemainingMoves).toEqual(S);
  });

  it('clearTrackFeedback and resetPhysicalTrack reset tracking', () => {
    useAppStore.getState().setScramble("L' D F2", S);
    useAppStore.getState().applyPhysicalTrackMove('R');
    useAppStore.getState().clearTrackFeedback();
    expect(useAppStore.getState().trackFeedback).toBeNull();

    useAppStore.getState().resetPhysicalTrack();
    const s = useAppStore.getState();
    expect(s.trackRemainingMoves).toEqual(S);
    expect(s.trackDoneMoves).toEqual([]);
    expect(s.trackCorrectionActive).toBe(false);
  });
});
