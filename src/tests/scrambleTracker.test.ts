import { describe, it, expect } from 'vitest';
import { classifyScrambleMove, type ScrambleClassification } from '../utils/scrambleTracker';

/** Thread a run of physical turns through the tracker. */
function run(scramble: string[], moves: string[]): ScrambleClassification {
  let done: string[] = [];
  let correctionActive = false;
  let last: ScrambleClassification = {
    kind: 'progress',
    nextRemaining: scramble,
    nextDone: [],
    corrections: [],
    correctionActive: false,
  };
  for (const m of moves) {
    last = classifyScrambleMove(scramble, done, m, correctionActive);
    done = last.nextDone;
    correctionActive = last.correctionActive;
  }
  return last;
}

const S = ["L'", 'D', 'F2'];

describe('classifyScrambleMove', () => {
  it('advances on the expected move', () => {
    const r = run(S, ["L'"]);
    expect(r.kind).toBe('progress');
    expect(r.nextRemaining).toEqual(['D', 'F2']);
    expect(r.corrections).toEqual([]);
  });

  it('treats a wrong-direction turn on the right face as a partial, not an error', () => {
    const r = run(S, ['L']);
    expect(r.kind).toBe('partial');
    expect(r.nextRemaining).toEqual(['L2', 'D', 'F2']);
    expect(r.corrections).toEqual(['L2']);
    expect(r.correctionActive).toBe(false);
  });

  it('half-completes an L2 with a single L, then finishes on the next L', () => {
    const scramble = ['L2', 'D', 'F2'];
    const half = run(scramble, ["L'"]);
    expect(half.kind).toBe('partial');
    expect(half.nextRemaining).toEqual(["L'", 'D', 'F2']);

    const done = run(scramble, ["L'", "L'"]);
    expect(done.kind).toBe('progress');
    expect(done.nextRemaining).toEqual(['D', 'F2']);
  });

  it('prepends a correction for a wrong face (non-adjacent)', () => {
    const r = run(S, ['R']);
    expect(r.kind).toBe('error');
    expect(r.nextRemaining).toEqual(["R'", "L'", 'D', 'F2']);
    expect(r.corrections).toEqual(["R'"]);
    expect(r.correctionActive).toBe(true);
  });

  it('prepends a correction for a wrong face that is adjacent (does not commute away)', () => {
    const r = run(S, ['D']); // expected L', D and L' do not commute
    expect(r.kind).toBe('error');
    expect(r.corrections).toEqual(["D'"]);
  });

  it('accepts adjacent commuting moves played out of order', () => {
    const r = run(['U', 'D', 'F2'], ['D']);
    expect(r.kind).toBe('progress');
    expect(r.nextRemaining).toEqual(['U', 'F2']);
    expect(r.corrections).toEqual([]);
  });

  it('flags an out-of-order move when a non-commuting move sits between', () => {
    const r = run(['U', 'F2', 'D'], ['D']);
    expect(r.kind).toBe('error');
  });

  it('accumulates corrections for two wrong moves in a row', () => {
    const r = run(S, ['R', 'F']);
    expect(r.kind).toBe('error');
    expect(r.corrections).toEqual(["F'", "R'"]);
    expect(r.nextRemaining).toEqual(["F'", "R'", "L'", 'D', 'F2']);
  });

  it('clears the correction when a wrong move is undone', () => {
    const r = run(S, ['R', "R'"]);
    expect(r.kind).toBe('progress');
    expect(r.correctionActive).toBe(false);
    expect(r.nextRemaining).toEqual(S);
  });

  it('keeps a repeated wrong move classified as an error, not a partial', () => {
    const r = run(S, ['R', 'R']);
    expect(r.kind).toBe('error');
    expect(r.corrections).toEqual(['R2']);
    expect(r.nextRemaining).toEqual(['R2', "L'", 'D', 'F2']);
  });

  it('ignores rotations and wide moves without touching the tracker', () => {
    for (const m of ['y', "Rw'", 'M']) {
      const r = run(S, [m]);
      expect(r.kind).toBe('ignored');
      expect(r.nextRemaining).toEqual(S);
      expect(r.nextDone).toEqual([]);
    }
  });

  it('reports completion when the last move lands the scramble', () => {
    const r = run(S, ["L'", 'D', 'F2']);
    expect(r.kind).toBe('complete');
    expect(r.nextRemaining).toEqual([]);
  });

  it('recovers to completion after a mistake and its correction', () => {
    const r = run(S, ['R', "R'", "L'", 'D', 'F2']);
    expect(r.kind).toBe('complete');
    expect(r.nextRemaining).toEqual([]);
  });
});
