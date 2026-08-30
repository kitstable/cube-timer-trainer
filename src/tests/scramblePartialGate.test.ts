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

  it('flushes the held move before the new one when a second turn arrives in-window', () => {
    // Models the tracker: the first R is a same-face partial; once it's committed the
    // second R completes the double turn and reads as progress.
    const committed: string[] = [];
    const gate = createScramblePartialGate({
      classify: () => (committed.length === 0 ? 'partial' : 'progress'),
      commit: (move) => committed.push(move),
      graceMs: 400,
    });

    gate.feed('R'); // held
    gate.feed('R'); // second half of a real R2 — arrives before the timer

    expect(committed).toEqual(['R', 'R']);

    // Timer must not double-commit.
    vi.advanceTimersByTime(400);
    expect(committed).toEqual(['R', 'R']);
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
