import { describe, it, expect, vi } from 'vitest';
import { syncPatternAndRoute } from '../hooks/useSmartCube';

function makeDeps() {
  return {
    syncPhysicalPattern: vi.fn(),
    setSmartCubeState: vi.fn(),
    setMode: vi.fn(),
  };
}

const solvedPattern = {
  patternData: {
    EDGES: { pieces: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], orientation: new Array(12).fill(0) },
    CORNERS: { pieces: [0, 1, 2, 3, 4, 5, 6, 7], orientation: new Array(8).fill(0) },
  },
};

const scrambledPattern = {
  patternData: {
    EDGES: { pieces: [1, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], orientation: new Array(12).fill(0) },
    CORNERS: { pieces: [0, 1, 2, 3, 4, 5, 6, 7], orientation: new Array(8).fill(0) },
  },
};

describe('syncPatternAndRoute', () => {
  it('routes to scramble mode when the physical cube reads as solved', async () => {
    const deps = makeDeps();
    const puzzle = { getPattern: vi.fn().mockResolvedValue(solvedPattern) };

    await syncPatternAndRoute(puzzle, deps);

    expect(deps.syncPhysicalPattern).toHaveBeenCalledWith(solvedPattern);
    expect(deps.setSmartCubeState).toHaveBeenCalledWith({ stateReadSupported: true });
    expect(deps.setMode).toHaveBeenCalledWith('scramble');
  });

  it('routes to timed mode when the physical cube reads as unsolved', async () => {
    const deps = makeDeps();
    const puzzle = { getPattern: vi.fn().mockResolvedValue(scrambledPattern) };

    await syncPatternAndRoute(puzzle, deps);

    expect(deps.syncPhysicalPattern).toHaveBeenCalledWith(scrambledPattern);
    expect(deps.setSmartCubeState).toHaveBeenCalledWith({ stateReadSupported: true });
    expect(deps.setMode).toHaveBeenCalledWith('timed');
  });

  it('flags stateReadSupported=false and does not touch the mode when getPattern is unsupported', async () => {
    const deps = makeDeps();
    const puzzle = {}; // no getPattern method at all

    await syncPatternAndRoute(puzzle, deps);

    expect(deps.syncPhysicalPattern).not.toHaveBeenCalled();
    expect(deps.setMode).not.toHaveBeenCalled();
    expect(deps.setSmartCubeState).toHaveBeenCalledWith({ stateReadSupported: false });
  });

  it('flags stateReadSupported=false and does not touch the mode when getPattern throws', async () => {
    const deps = makeDeps();
    const puzzle = { getPattern: vi.fn().mockRejectedValue(new Error('BLE read failed')) };

    await syncPatternAndRoute(puzzle, deps);

    expect(deps.syncPhysicalPattern).not.toHaveBeenCalled();
    expect(deps.setMode).not.toHaveBeenCalled();
    expect(deps.setSmartCubeState).toHaveBeenCalledWith({ stateReadSupported: false });
  });

  it('flags stateReadSupported=false and does not touch the mode when getPattern resolves empty', async () => {
    const deps = makeDeps();
    const puzzle = { getPattern: vi.fn().mockResolvedValue(null) };

    await syncPatternAndRoute(puzzle, deps);

    expect(deps.syncPhysicalPattern).not.toHaveBeenCalled();
    expect(deps.setMode).not.toHaveBeenCalled();
    expect(deps.setSmartCubeState).toHaveBeenCalledWith({ stateReadSupported: false });
  });
});
