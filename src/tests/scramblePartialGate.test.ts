import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScramblePartialGate } from '../utils/scramblePartialGate';
import type { ScrambleMoveKind } from '../utils/scrambleTracker';

describe('createScramblePartialGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(kinds: Record<string, ScrambleMoveKind>) {
    const committed: string[] = [];
    const gate = createScramblePartialGate({
      classify: (move) => kinds[move] ?? 'progress',
      commit: (move) => committed.push(move),
      graceMs: 400,
    });
    return { gate, committed };
  }

  it('holds a partial, then commits it once when the grace timer fires', () => {
    const { gate, committed } = setup({ R: 'partial' });
    gate.feed('R');
    expect(committed).toEqual([]);

    vi.advanceTimersByTime(399);
    expect(committed).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(committed).toEqual(['R']);
  });

  it('merges a same-face second turn into one move (a real R2), never showing the half state', () => {
    // The first R is a same-face partial; a second R before the timer is the other half of
    // a physical R2. The gate merges them and commits `R2` once — the tracker never sees an
    // interim "one done, one to go" state.
    const committed: string[] = [];
    const gate = createScramblePartialGate({
      classify: (m) => (m === 'R' ? 'partial' : 'progress'),
      commit: (move) => committed.push(move),
      graceMs: 400,
    });

    gate.feed('R'); // held
    gate.feed('R'); // second half of a real R2 — arrives before the timer
    expect(committed).toEqual(['R2']);

    // Timer must not double-commit.
    vi.advanceTimersByTime(400);
    expect(committed).toEqual(['R2']);
  });

  it('drops a same-face pair that cancels (R then R′) as a no-op wobble', () => {
    const committed: string[] = [];
    const gate = createScramblePartialGate({
      classify: () => 'partial',
      commit: (move) => committed.push(move),
      graceMs: 400,
    });
    gate.feed('R'); // held
    gate.feed("R'"); // turned straight back
    expect(committed).toEqual([]);
    vi.advanceTimersByTime(400);
    expect(committed).toEqual([]);
  });

  it('commits a held partial then the new turn when the second turn is a different face', () => {
    const committed: string[] = [];
    const gate = createScramblePartialGate({
      classify: (m) => (m === 'R' ? 'partial' : 'error'),
      commit: (move) => committed.push(move),
      graceMs: 400,
    });
    gate.feed('R'); // held (mid-face stop)
    gate.feed('U'); // moved to a different face — genuine mistake
    expect(committed).toEqual(['R', 'U']);
  });

  it('does not defer progress / error / complete / ignored', () => {
    const { gate, committed } = setup({ R: 'progress', L: 'error', F: 'complete', y: 'ignored' });
    gate.feed('R');
    gate.feed('L');
    gate.feed('F');
    gate.feed('y');
    expect(committed).toEqual(['R', 'L', 'F', 'y']);
  });

  it('reset() drops a held move without committing it', () => {
    const { gate, committed } = setup({ R: 'partial' });
    gate.feed('R');
    gate.reset();
    vi.advanceTimersByTime(400);
    expect(committed).toEqual([]);
  });

  it('flush() commits a held move immediately', () => {
    const { gate, committed } = setup({ R: 'partial' });
    gate.feed('R');
    gate.flush();
    expect(committed).toEqual(['R']);
    vi.advanceTimersByTime(400);
    expect(committed).toEqual(['R']);
  });
});
