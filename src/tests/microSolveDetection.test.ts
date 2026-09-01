import { describe, it, expect } from 'vitest';

export function isMicroSolve(movesCount: number, timeMs: number, isCubeConnected: boolean): boolean {
  return (
    (isCubeConnected && movesCount < 3) ||
    (!isCubeConnected && timeMs < 1000) ||
    timeMs < 800
  );
}

describe('Micro-Solve Detection Logic', () => {
  it('identifies connected smart cube 1-move or 2-move solves as micro-solves', () => {
    // 1-turn connect accidental solve (0.45s, 1 move)
    expect(isMicroSolve(1, 450, true)).toBe(true);
    // 2-turn connect accidental solve (1.1s, 2 moves)
    expect(isMicroSolve(2, 1100, true)).toBe(true);
  });

  it('identifies manual solves under 1 second as micro-solves', () => {
    expect(isMicroSolve(0, 750, false)).toBe(true);
    expect(isMicroSolve(0, 950, false)).toBe(true);
  });

  it('treats genuine speedcubing solves as valid non-micro-solves', () => {
    // Normal 3x3 solve (45 moves, 18.5s)
    expect(isMicroSolve(45, 18500, true)).toBe(false);
    // Fast smart cube solve (30 moves, 8.2s)
    expect(isMicroSolve(30, 8200, true)).toBe(false);
    // Manual 3x3 solve (12.4s)
    expect(isMicroSolve(0, 12400, false)).toBe(false);
  });
});
