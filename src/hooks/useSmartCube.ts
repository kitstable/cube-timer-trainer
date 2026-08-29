import { useCallback } from 'react';
import { connectSmartPuzzle } from 'cubing/bluetooth';
import { useCubeStore } from '../store/useCubeStore';
import { useAppStore } from '../store/useAppStore';
import { isPatternSolved } from '../utils/kpuzzleHelper';

// Module-level singleton keeps the Bluetooth connection active across modal opens/closes
let activeSmartPuzzle: any = null;

export function useSmartCube() {
  const { applyMove, setSmartCubeState, syncPhysicalPattern } = useCubeStore();
  const { setMode, advanceScrambleProgress } = useAppStore();

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

      // 1. Sync physical pattern from smart cube if supported
      try {
        if (typeof puzzle.getPattern === 'function') {
          const initialPattern = await puzzle.getPattern();
          if (initialPattern) {
            syncPhysicalPattern(initialPattern);
            const solved = isPatternSolved(initialPattern);
            if (solved) {
              setMode('scramble');
            } else {
              setMode('timed');
            }
          }
        }
      } catch (patternErr) {
        console.warn('Physical cube initial getPattern not available or failed:', patternErr);
      }

      // 2. Listen for live turns from smart cube
      puzzle.addAlgLeafListener((leafEvent: any) => {
        const latestLeaf = leafEvent?.latestAlgLeaf;
        if (!latestLeaf) return;

        const moveStr = latestLeaf.toString().trim();
        if (!moveStr) return;

        // Dispatch move directly to store
        applyMove(moveStr);

        // If in Scramble mode, check expected move and advance
        const currentScrambleMoves = useAppStore.getState().scrambleMoves;
        const currentProg = useAppStore.getState().scrambleProgressIndex;
        const currentMode = useAppStore.getState().activeMode;

        if (currentMode === 'scramble' && currentScrambleMoves.length > 0) {
          const expected = currentScrambleMoves[currentProg];
          if (expected && expected === moveStr) {
            advanceScrambleProgress();
          }
        }
      });

      // 3. Handle disconnect event
      const device = puzzle.device || (puzzle.server && puzzle.server.device);
      if (device && device.addEventListener) {
        device.addEventListener('gattserverdisconnected', () => {
          activeSmartPuzzle = null;
          setSmartCubeState({
            isConnected: false,
            isConnecting: false,
            deviceName: null,
            batteryLevel: null,
            error: null,
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
      });
    }
  }, [applyMove, setSmartCubeState, syncPhysicalPattern, setMode, advanceScrambleProgress]);

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
    });
  }, [setSmartCubeState]);

  const resyncFromCube = useCallback(async () => {
    if (!activeSmartPuzzle) return;
    try {
      if (typeof activeSmartPuzzle.getPattern === 'function') {
        const p = await activeSmartPuzzle.getPattern();
        if (p) {
          syncPhysicalPattern(p);
        }
      }
    } catch (err) {
      console.warn('Failed to resync pattern from physical cube:', err);
    }
  }, [syncPhysicalPattern]);

  return {
    connect,
    disconnect,
    resyncFromCube,
    hasActiveConnection: () => Boolean(activeSmartPuzzle),
  };
}

