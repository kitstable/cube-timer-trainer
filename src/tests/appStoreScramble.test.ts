import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store/useAppStore';

const S = ["L'", 'D', 'F2'];

function reset() {
  useAppStore.setState({
    scrambleMoves: [],
    scrambleProgressIndex: 0,
    scrambleRemainingMoves: [],
    scrambleDoneMoves: [],
    scrambleFeedback: null,
    scrambleCorrectionActive: false,
  });
}

describe('useAppStore — physical scramble tracking', () => {
  beforeEach(reset);

  it('setScramble seeds the tracker fields', () => {
    useAppStore.getState().setScramble("L' D F2", S);
    const s = useAppStore.getState();
    expect(s.scrambleRemainingMoves).toEqual(S);
    expect(s.scrambleDoneMoves).toEqual([]);
    expect(s.scrambleFeedback).toBeNull();
    expect(s.scrambleCorrectionActive).toBe(false);
  });

  it('a correct run advances remaining and never raises feedback', () => {
    useAppStore.getState().setScramble("L' D F2", S);
    for (const m of S) useAppStore.getState().applyPhysicalScrambleMove(m);
    const s = useAppStore.getState();
    expect(s.scrambleRemainingMoves).toEqual([]);
    expect(s.scrambleFeedback).toBeNull();
    expect(s.scrambleDoneMoves).toEqual(S);
  });

  it('a wrong turn raises error feedback, which clears on the correcting turn', () => {
    useAppStore.getState().setScramble("L' D F2", S);
    useAppStore.getState().applyPhysicalScrambleMove('R');
    let s = useAppStore.getState();
    expect(s.scrambleFeedback?.kind).toBe('error');
    expect(s.scrambleFeedback?.corrections).toEqual(["R'"]);
    expect(s.scrambleRemainingMoves).toEqual(["R'", "L'", 'D', 'F2']);

    useAppStore.getState().applyPhysicalScrambleMove("R'");
    s = useAppStore.getState();
    expect(s.scrambleFeedback).toBeNull();
    expect(s.scrambleCorrectionActive).toBe(false);
    expect(s.scrambleRemainingMoves).toEqual(S);
  });

  it('a rotation is ignored and leaves state untouched', () => {
    useAppStore.getState().setScramble("L' D F2", S);
    useAppStore.getState().applyPhysicalScrambleMove('y');
    const s = useAppStore.getState();
    expect(s.scrambleDoneMoves).toEqual([]);
    expect(s.scrambleRemainingMoves).toEqual(S);
  });

  it('clearScrambleFeedback and resetPhysicalScramble reset tracking', () => {
    useAppStore.getState().setScramble("L' D F2", S);
    useAppStore.getState().applyPhysicalScrambleMove('R');
    useAppStore.getState().clearScrambleFeedback();
    expect(useAppStore.getState().scrambleFeedback).toBeNull();

    useAppStore.getState().resetPhysicalScramble();
    const s = useAppStore.getState();
    expect(s.scrambleRemainingMoves).toEqual(S);
    expect(s.scrambleDoneMoves).toEqual([]);
    expect(s.scrambleCorrectionActive).toBe(false);
  });
});
