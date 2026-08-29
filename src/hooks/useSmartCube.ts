import { useCallback } from 'react';
import { connectSmartPuzzle } from 'cubing/bluetooth';
import { useCubeStore } from '../store/useCubeStore';
import { useAppStore } from '../store/useAppStore';
import { useSolverWorker } from './useSolverWorker';
import { isPatternSolved } from '../utils/kpuzzleHelper';
import type { AppMode, SmartCubeState } from '../types/cube';

// Module-level singleton keeps the Bluetooth connection active across modal opens/closes
let activeSmartPuzzle: any = null;

/**
 * Reads the physical cube's pattern from the puzzle (when the protocol supports it) and,
 * on success, syncs the store and auto-routes: solved -> Scramble, unsolved -> Timed.
 *
 * Deliberately never guesses a mode from stale/default app state. When the puzzle can't
 * report its pattern (unsupported protocol, or a failed/empty read), it only flags
 * `stateReadSupported: false` and leaves `activeMode` untouched, so the UI can point the
 * user at manual calibration instead of silently pretending to have detected something.
 */
export async function syncPatternAndRoute(
  puzzle: any,
  deps: {
    syncPhysicalPattern: (pattern: any) => void;
    setSmartCubeState: (state: Partial<SmartCubeState>) => void;
    setMode: (mode: AppMode) => void;
    setVisualAlg: (alg: string) => void;
    reconstructAlg: (patternData: any) => Promise<string>;
  }
): Promise<void> {
  const { syncPhysicalPattern, setSmartCubeState, setMode, setVisualAlg, reconstructAlg } = deps;

  if (typeof puzzle.getPattern !== 'function') {
    console.warn('Smart cube: this protocol does not support getPattern() — physical state is unknown.');
    setSmartCubeState({ stateReadSupported: false });
    setVisualAlg('');
    return;
  }

  try {
    const pattern = await puzzle.getPattern();
    if (!pattern) {
      console.warn('Smart cube: getPattern() returned nothing — physical state is unknown.');
      setSmartCubeState({ stateReadSupported: false });
      setVisualAlg('');
      return;
    }

    syncPhysicalPattern(pattern);
    setSmartCubeState({ stateReadSupported: true });

    const solved = isPatternSolved(pattern);
    const mode: AppMode = solved ? 'scramble' : 'timed';
    console.info(`Smart cube: state read OK (solved=${solved}) — routing to '${mode}'.`);
    setMode(mode);

    // Best-effort: reconstruct an alg reaching this pattern from solved, purely so the 3D
    // visualizer can mirror the cube's real physical state (e.g. mid-solve on connect).
    // Non-fatal if it fails — the visualizer just falls back to a plain solved cube.
    if (solved) {
      setVisualAlg('');
    } else {
      try {
        const alg = await reconstructAlg(pattern.patternData);
        setVisualAlg(alg);
      } catch (reconErr) {
        console.warn('Smart cube: failed to reconstruct visualization alg:', reconErr);
      }
    }
  } catch (err) {
    console.warn('Smart cube: getPattern() failed — physical state is unknown.', err);
    setSmartCubeState({ stateReadSupported: false });
    setVisualAlg('');
  }
}

export function useSmartCube() {
  const { applyMove, setSmartCubeState, syncPhysicalPattern, setVisualAlg } = useCubeStore();
  const { setMode, advanceScrambleProgress } = useAppStore();
  const { reconstructAlg } = useSolverWorker();

  const connect = useCallback(async () => {
    setSmartCubeState({ isConnecting: true, error: null });

    try {
      const puzzle: any = await connectSmartPuzzle();
      activeSmartPuzzle = puzzle;

      const deviceName =
        typeof puzzle.name === 'function' ? puzzle.name() : (puzzle.name || 'Smart Cube');

      let batteryLevel: number | null = null;
      if (typeof puzzle.getBattery === 'function') {
        try {
          batteryLevel = await puzzle.getBattery();
        } catch {
          // ignore battery read error
        }
      }

      setSmartCubeState({
        isConnected: true,
        isConnecting: false,
        deviceName,
        batteryLevel,
        error: null,
      });

      // 1. Sync physical pattern from smart cube if supported, and auto-route accordingly
      await syncPatternAndRoute(puzzle, { syncPhysicalPattern, setSmartCubeState, setMode, setVisualAlg, reconstructAlg });

      // 2. Listen for live turns from smart cube
      puzzle.addAlgLeafListener((leafEvent: any) => {
        const latestLeaf = leafEvent?.latestAlgLeaf;
        if (!latestLeaf) return;

        const moveStr = latestLeaf.toString().trim();
        if (!moveStr) return;

        const timestamp = typeof leafEvent?.timeStamp === 'number' && leafEvent.timeStamp > 0
          ? leafEvent.timeStamp
          : Date.now();

        // Dispatch move directly to store
        applyMove(moveStr, timestamp);

        // If in Scramble mode, check expected move and advance
        const { activeMode, scrambleMoves, scrambleProgressIndex } = useAppStore.getState();

        if (activeMode === 'scramble' && scrambleMoves.length > 0) {
          const expected = scrambleMoves[scrambleProgressIndex];
          if (expected && expected === moveStr) {
            advanceScrambleProgress();
          }
        }
      });

      // 3. Handle disconnect event
      const device = puzzle.device || puzzle.server?.device || puzzle.primaryService?.device;
      if (device && device.addEventListener) {
        device.addEventListener('gattserverdisconnected', () => {
          activeSmartPuzzle = null;
          setSmartCubeState({
            isConnected: false,
            isConnecting: false,
            deviceName: null,
            batteryLevel: null,
            error: null,
            stateReadSupported: true,
          });
        });
      }
    } catch (err: any) {
      console.warn('Smart cube connection error or cancelled:', err);
      activeSmartPuzzle = null;
      setSmartCubeState({
        isConnected: false,
        isConnecting: false,
        error: err?.message || 'Connection cancelled or failed',
        stateReadSupported: true,
      });
    }
  }, [applyMove, setSmartCubeState, syncPhysicalPattern, setMode, advanceScrambleProgress, setVisualAlg, reconstructAlg]);

  const disconnect = useCallback(() => {
    if (activeSmartPuzzle) {
      try {
        if (typeof activeSmartPuzzle.disconnect === 'function') {
          activeSmartPuzzle.disconnect();
        } else if (activeSmartPuzzle.device?.gatt?.connected) {
          activeSmartPuzzle.device.gatt.disconnect();
        } else if (activeSmartPuzzle.server?.device?.gatt?.connected) {
          activeSmartPuzzle.server.device.gatt.disconnect();
        }
      } catch (err) {
        console.warn('Error disconnecting smart puzzle:', err);
      }
      activeSmartPuzzle = null;
    }

    setSmartCubeState({
      isConnected: false,
      isConnecting: false,
      deviceName: null,
      batteryLevel: null,
      error: null,
      stateReadSupported: true,
    });
  }, [setSmartCubeState]);

  const resyncFromCube = useCallback(async () => {
    if (!activeSmartPuzzle) return;
    await syncPatternAndRoute(activeSmartPuzzle, { syncPhysicalPattern, setSmartCubeState, setMode, setVisualAlg, reconstructAlg });
  }, [syncPhysicalPattern, setSmartCubeState, setMode, setVisualAlg, reconstructAlg]);

  return {
    connect,
    disconnect,
    resyncFromCube,
    hasActiveConnection: () => Boolean(activeSmartPuzzle),
  };
}
