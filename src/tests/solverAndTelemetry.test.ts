import { describe, it, expect, beforeAll } from 'vitest';
import { Alg } from 'cubing/alg';
import { getKPuzzle, getPostZ2Pattern } from '../utils/kpuzzleHelper';
import { solveCrossBFS } from '../solver/crossBfs';
import { calculateSolveTelemetry, formatTime } from '../utils/telemetryCalculator';
import { computeAverage } from '../db/repository';

describe('Cross BFS Solver', () => {
  beforeAll(async () => {
    await getKPuzzle();
  });

  it('returns empty array when cross is already solved', () => {
    const pattern = getPostZ2Pattern();
    const solution = solveCrossBFS(pattern);
    expect(solution).toEqual([]);
  });

  it('finds optimal solution for a 1-move scrambled cross', () => {
    const pattern = getPostZ2Pattern().applyAlg(new Alg("D"));
    const solution = solveCrossBFS(pattern, 4);
    expect(solution.length).toBe(1);
    expect(solution[0]).toBe("D'");
  });

  it('finds optimal solution for a multi-move scrambled cross', () => {
    const scramble = "R U R' F' D2";
    const pattern = getPostZ2Pattern().applyAlg(new Alg(scramble));
    const solution = solveCrossBFS(pattern, 8);
    console.log('Multi-move cross solution for', scramble, 'is:', solution);
    expect(solution.length).toBeGreaterThan(0);
    const solvedAfter = pattern.applyAlg(new Alg(solution.join(' ')));
    expect(solveCrossBFS(solvedAfter, 4)).toEqual([]);
  });

  it('finds cross solution for a full WCA scramble', () => {
    const scramble = "D2 B2 F2 R' D2 R' B2 R D2 R U2 F L' U' F' L2 D B2 D R2";
    const pattern = getPostZ2Pattern().applyAlg(new Alg(scramble));
    const solution = solveCrossBFS(pattern, 8);
    console.log('Full WCA cross solution is:', solution);
    expect(solution.length).toBeGreaterThan(0);
    const solvedAfter = pattern.applyAlg(new Alg(solution.join(' ')));
    expect(solveCrossBFS(solvedAfter, 4)).toEqual([]);
  });
});



describe('Telemetry and Stats Calculations', () => {
  it('computes WCA Ao5 with trimmed best and worst times', () => {
    const times = [10000, 12000, 8000, 11000, 13000]; // Sorted: 8000, 10000, 11000, 12000, 13000 -> Trimmed: 10000, 11000, 12000 -> Avg: 11000
    const ao5 = computeAverage(times);
    expect(ao5).toBe(11000);
  });

  it('calculates TPS and phase splits from timestamped moves', () => {
    const result = calculateSolveTelemetry(
      3000, // 3s inspection
      [
        { move: 'R', timestamp: 1000, deltaMs: 200, phase: 'cross' },
        { move: 'U', timestamp: 1200, deltaMs: 200, phase: 'cross' },
        { move: "R'", timestamp: 1400, deltaMs: 200, phase: 'cross' },
        { move: "F'", timestamp: 1600, deltaMs: 200, phase: 'f2l-1' },
      ],
      5000, // 5s solve
      true
    );

    expect(result.totalMoves).toBe(4);
    expect(result.overallTps).toBe(0.8);
    expect(result.phases.length).toBeGreaterThanOrEqual(2);
    expect(result.phases[0].name).toBe('inspection');
    expect(result.phases[1].name).toBe('cross');
  });

  it('formats time with minutes and hundredths correctly', () => {
    expect(formatTime(14920).full).toBe('14.92');
    expect(formatTime(75230).full).toBe('1:15.23');
  });
});
