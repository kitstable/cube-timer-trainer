import { describe, it, expect } from 'vitest';
import { calculateSessionStats } from '../db/repository';
import { getEffectiveTimeMs, type Solve } from '../types/db';

describe('Session Stats, Penalties, and Best Solve (PB) ID', () => {
  it('calculates getEffectiveTimeMs taking +2 into account', () => {
    expect(getEffectiveTimeMs({ totalTimeMs: 15000 })).toBe(15000);
    expect(getEffectiveTimeMs({ totalTimeMs: 15000, plusTwo: false })).toBe(15000);
    expect(getEffectiveTimeMs({ totalTimeMs: 15000, plusTwo: true })).toBe(17000);
  });

  it('calculates stats with +2 penalties correctly and identifies bestSolveId', () => {
    const solves: Solve[] = [
      {
        id: 'solve-1',
        profileId: 'p1',
        scrambleMoves: ['R', 'U'],
        mode: 'timed',
        cubeConnected: true,
        phases: [],
        totalTimeMs: 10000,
        createdAt: 100,
      },
      {
        id: 'solve-2',
        profileId: 'p1',
        scrambleMoves: ['R', 'U'],
        mode: 'timed',
        cubeConnected: true,
        phases: [],
        totalTimeMs: 9000,
        plusTwo: true, // Effective time: 11000ms
        createdAt: 200,
      },
      {
        id: 'solve-3',
        profileId: 'p1',
        scrambleMoves: ['R', 'U'],
        mode: 'timed',
        cubeConnected: true,
        phases: [],
        totalTimeMs: 8500, // Best solve!
        createdAt: 300,
      },
      {
        id: 'solve-4',
        profileId: 'p1',
        scrambleMoves: ['R', 'U'],
        mode: 'timed',
        cubeConnected: true,
        phases: [],
        totalTimeMs: 7000,
        dnf: true, // DNF - should not be best!
        createdAt: 400,
      },
    ];

    const stats = calculateSessionStats(solves);
    expect(stats.count).toBe(4);
    expect(stats.best).toBe(8500);
    expect(stats.bestSolveId).toBe('solve-3');
    expect(stats.worst).toBe(11000); // solve-2 with +2
    expect(stats.mean).toBe(Math.round((10000 + 11000 + 8500) / 3)); // 9833
  });

  it('correctly shifts bestSolveId when penalties change', () => {
    const solves: Solve[] = [
      {
        id: 'solve-1',
        profileId: 'p1',
        scrambleMoves: [],
        mode: 'timed',
        cubeConnected: false,
        phases: [],
        totalTimeMs: 10000,
        createdAt: 100,
      },
      {
        id: 'solve-2',
        profileId: 'p1',
        scrambleMoves: [],
        mode: 'timed',
        cubeConnected: false,
        phases: [],
        totalTimeMs: 9500,
        plusTwo: true, // 11500ms
        createdAt: 200,
      },
    ];

    const stats = calculateSessionStats(solves);
    // Because solve-2 has +2, solve-1 (10000ms) is faster than solve-2 (11500ms)
    expect(stats.best).toBe(10000);
    expect(stats.bestSolveId).toBe('solve-1');
  });

  it('handles empty solve list with null bestSolveId', () => {
    const stats = calculateSessionStats([]);
    expect(stats.count).toBe(0);
    expect(stats.best).toBeNull();
    expect(stats.bestSolveId).toBeNull();
  });

  describe('Solve List Sorting', () => {
    const testSolves: Solve[] = [
      { id: '1', profileId: 'p1', scrambleMoves: [], mode: 'timed', cubeConnected: false, phases: [], totalTimeMs: 12000, createdAt: 1000 },
      { id: '2', profileId: 'p1', scrambleMoves: [], mode: 'timed', cubeConnected: false, phases: [], totalTimeMs: 8000, createdAt: 2000 },
      { id: '3', profileId: 'p1', scrambleMoves: [], mode: 'timed', cubeConnected: false, phases: [], totalTimeMs: 15000, plusTwo: true, createdAt: 3000 }, // 17000ms
      { id: '4', profileId: 'p1', scrambleMoves: [], mode: 'timed', cubeConnected: false, phases: [], totalTimeMs: 5000, dnf: true, createdAt: 4000 }, // DNF
    ];

    it('sorts by Date (Newest first) and Date (Oldest first)', () => {
      const newestFirst = [...testSolves].sort((a, b) => b.createdAt - a.createdAt);
      expect(newestFirst.map((s) => s.id)).toEqual(['4', '3', '2', '1']);

      const oldestFirst = [...testSolves].sort((a, b) => a.createdAt - b.createdAt);
      expect(oldestFirst.map((s) => s.id)).toEqual(['1', '2', '3', '4']);
    });

    it('sorts by Time (Fastest first) with DNFs placed at the bottom', () => {
      const fastestFirst = [...testSolves].sort((a, b) => {
        if (a.dnf && !b.dnf) return 1;
        if (!a.dnf && b.dnf) return -1;
        if (a.dnf && b.dnf) return b.createdAt - a.createdAt;
        return getEffectiveTimeMs(a) - getEffectiveTimeMs(b);
      });
      // 8000ms (#2) -> 12000ms (#1) -> 17000ms (#3) -> DNF (#4)
      expect(fastestFirst.map((s) => s.id)).toEqual(['2', '1', '3', '4']);
    });

    it('sorts by Time (Slowest first) with DNFs placed at the top', () => {
      const slowestFirst = [...testSolves].sort((a, b) => {
        if (a.dnf && !b.dnf) return -1;
        if (!a.dnf && b.dnf) return 1;
        if (a.dnf && b.dnf) return b.createdAt - a.createdAt;
        return getEffectiveTimeMs(b) - getEffectiveTimeMs(a);
      });
      // DNF (#4) -> 17000ms (#3) -> 12000ms (#1) -> 8000ms (#2)
      expect(slowestFirst.map((s) => s.id)).toEqual(['4', '3', '1', '2']);
    });
  });
});

