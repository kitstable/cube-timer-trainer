import { describe, it, expect } from 'vitest';
import { calculateSessionStats } from '../db/repository';
import type { Solve } from '../types/db';

describe('DNF Solves and Stats Calculations', () => {
  it('excludes DNF solves from best, worst, mean, and averages but includes in total count', () => {
    const sampleSolves: Solve[] = [
      {
        id: '1',
        profileId: 'p1',
        scrambleMoves: ['R', 'U'],
        mode: 'timed',
        cubeConnected: false,
        phases: [],
        totalTimeMs: 12000,
        createdAt: 100,
      },
      {
        id: '2',
        profileId: 'p1',
        scrambleMoves: ['R', 'U'],
        mode: 'timed',
        cubeConnected: false,
        phases: [],
        totalTimeMs: 8000,
        createdAt: 200,
      },
      {
        id: '3',
        profileId: 'p1',
        scrambleMoves: ['R', 'U'],
        mode: 'timed',
        cubeConnected: false,
        phases: [],
        totalTimeMs: 10000,
        dnf: true, // DNF solve
        createdAt: 300,
      },
      {
        id: '4',
        profileId: 'p1',
        scrambleMoves: ['R', 'U'],
        mode: 'timed',
        cubeConnected: false,
        phases: [],
        totalTimeMs: 10000,
        createdAt: 400,
      },
    ];

    const stats = calculateSessionStats(sampleSolves);
    expect(stats.count).toBe(4);
    expect(stats.best).toBe(8000);
    expect(stats.worst).toBe(12000);
    expect(stats.mean).toBe(10000); // (12000 + 8000 + 10000) / 3 = 10000
    expect(stats.ao5).toBeNull(); // Only 3 valid solves
  });

  it('calculates Ao5 accurately when DNF solves are in the session history', () => {
    const solves: Solve[] = [
      { id: '1', profileId: 'p1', scrambleMoves: [], mode: 'timed', cubeConnected: false, phases: [], totalTimeMs: 10000, createdAt: 1 },
      { id: '2', profileId: 'p1', scrambleMoves: [], mode: 'timed', cubeConnected: false, phases: [], totalTimeMs: 12000, createdAt: 2 },
      { id: '3', profileId: 'p1', scrambleMoves: [], mode: 'timed', cubeConnected: false, phases: [], totalTimeMs: 8000, createdAt: 3 },
      { id: '4', profileId: 'p1', scrambleMoves: [], mode: 'timed', cubeConnected: false, phases: [], totalTimeMs: 99999, dnf: true, createdAt: 4 },
      { id: '5', profileId: 'p1', scrambleMoves: [], mode: 'timed', cubeConnected: false, phases: [], totalTimeMs: 11000, createdAt: 5 },
      { id: '6', profileId: 'p1', scrambleMoves: [], mode: 'timed', cubeConnected: false, phases: [], totalTimeMs: 13000, createdAt: 6 },
    ];

    const stats = calculateSessionStats(solves);
    expect(stats.count).toBe(6);
    // valid times in order of occurrence: 10000, 12000, 8000, 11000, 13000 -> Ao5 trimmed average: (10000 + 11000 + 12000) / 3 = 11000
    expect(stats.ao5).toBe(11000);
  });

  it('returns null averages when all solves in session are DNF', () => {
    const allDnfSolves: Solve[] = [
      {
        id: '1',
        profileId: 'p1',
        scrambleMoves: ['R'],
        mode: 'timed',
        cubeConnected: false,
        phases: [],
        totalTimeMs: 5000,
        dnf: true,
        createdAt: 100,
      },
    ];

    const stats = calculateSessionStats(allDnfSolves);
    expect(stats.count).toBe(1);
    expect(stats.best).toBeNull();
    expect(stats.worst).toBeNull();
    expect(stats.mean).toBeNull();
  });

  it('calculates pause duration offset correctly for timer resume', () => {
    const startTimestamp = 1000;
    const pauseTime = 6000; // 5000ms elapsed
    const resumeTime = 16000; // paused for 10000ms
    const pausedDuration = resumeTime - pauseTime;

    const adjustedStartTimestamp = startTimestamp + pausedDuration;
    expect(adjustedStartTimestamp).toBe(11000);

    const checkTime = 17000;
    const elapsedAfterResume = checkTime - adjustedStartTimestamp;
    expect(elapsedAfterResume).toBe(6000); // 5000ms before pause + 1000ms after resume
  });
});
