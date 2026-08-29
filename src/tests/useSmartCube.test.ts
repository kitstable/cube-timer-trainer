import { describe, it, expect, vi } from 'vitest';
import { syncPatternAndRoute } from '../hooks/useSmartCube';

function makeDeps() {
  return {
    syncPhysicalPattern: vi.fn(),
    setSmartCubeState: vi.fn(),
    setMode: vi.fn(),
    setVisualAlg: vi.fn(),
    reconstructAlg: vi.fn().mockResolvedValue('R U R\''),
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
    // Already solved: no need to call the solver, just clear any stale alg.
    expect(deps.reconstructAlg).not.toHaveBeenCalled();
    expect(deps.setVisualAlg).toHaveBeenCalledWith('');
  });

  it('routes to timed mode and reconstructs a visualization alg when the cube reads as unsolved', async () => {
    const deps = makeDeps();
    const puzzle = { getPattern: vi.fn().mockResolvedValue(scrambledPattern) };

    await syncPatternAndRoute(puzzle, deps);

    expect(deps.syncPhysicalPattern).toHaveBeenCalledWith(scrambledPattern);
    expect(deps.setSmartCubeState).toHaveBeenCalledWith({ stateReadSupported: true });
    expect(deps.setMode).toHaveBeenCalledWith('timed');
    expect(deps.reconstructAlg).toHaveBeenCalledWith(scrambledPattern.patternData);
    expect(deps.setVisualAlg).toHaveBeenCalledWith('R U R\'');
  });

  it('flags stateReadSupported=false and does not touch the mode when getPattern is unsupported', async () => {
    const deps = makeDeps();
    const puzzle = {}; // no getPattern method at all

    await syncPatternAndRoute(puzzle, deps);

    expect(deps.syncPhysicalPattern).not.toHaveBeenCalled();
    expect(deps.setMode).not.toHaveBeenCalled();
    expect(deps.setSmartCubeState).toHaveBeenCalledWith({ stateReadSupported: false });
    expect(deps.setVisualAlg).toHaveBeenCalledWith('');
  });

  it('flags stateReadSupported=false and does not touch the mode when getPattern throws', async () => {
    const deps = makeDeps();
    const puzzle = { getPattern: vi.fn().mockRejectedValue(new Error('BLE read failed')) };

    await syncPatternAndRoute(puzzle, deps);

    expect(deps.syncPhysicalPattern).not.toHaveBeenCalled();
    expect(deps.setMode).not.toHaveBeenCalled();
    expect(deps.setSmartCubeState).toHaveBeenCalledWith({ stateReadSupported: false });
    expect(deps.setVisualAlg).toHaveBeenCalledWith('');
  });

  it('flags stateReadSupported=false and does not touch the mode when getPattern resolves empty', async () => {
    const deps = makeDeps();
    const puzzle = { getPattern: vi.fn().mockResolvedValue(null) };

    await syncPatternAndRoute(puzzle, deps);

    expect(deps.syncPhysicalPattern).not.toHaveBeenCalled();
    expect(deps.setMode).not.toHaveBeenCalled();
    expect(deps.setSmartCubeState).toHaveBeenCalledWith({ stateReadSupported: false });
    expect(deps.setVisualAlg).toHaveBeenCalledWith('');
  });

  it('still flags stateReadSupported=true if the visualization reconstruction itself fails', async () => {
    const deps = makeDeps();
    deps.reconstructAlg.mockRejectedValue(new Error('solver worker error'));
    const puzzle = { getPattern: vi.fn().mockResolvedValue(scrambledPattern) };

    await syncPatternAndRoute(puzzle, deps);

    expect(deps.setSmartCubeState).toHaveBeenCalledWith({ stateReadSupported: true });
    expect(deps.setMode).toHaveBeenCalledWith('timed');
    // Reconstruction failing is non-fatal — it just leaves the visualizer without a
    // physical overlay, it doesn't undo the otherwise-successful state read/routing.
    expect(deps.setVisualAlg).not.toHaveBeenCalled();
  });
});
