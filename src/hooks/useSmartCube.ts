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
        let initialPattern = null;
        if (typeof puzzle.getPattern === 'function') {
          try {
            initialPattern = await puzzle.getPattern();
          } catch (getPatErr) {
            console.warn('Physical cube getPattern() failed or unsupported:', getPatErr);
          }
        }

        if (initialPattern) {
          syncPhysicalPattern(initialPattern);
          const solved = isPatternSolved(initialPattern);
          if (solved) {
            setMode('scramble');
          } else {
            setMode('timed');
          }
        } else {
          // If getPattern is not supported (e.g. GoCube), check store pattern or default to scramble
          const cur = useCubeStore.getState().pattern;
          if (cur && !isPatternSolved(cur)) {
            setMode('timed');
          } else {
            setMode('scramble');
          }
        }
      } catch (patternErr) {
        console.warn('Physical cube initial sync failed:', patternErr);
        setMode('scramble');
      }

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
          const solved = isPatternSolved(p);
          if (solved) {
            setMode('scramble');
          } else {
            setMode('timed');
          }
        }
      }
    } catch (err) {
      console.warn('Failed to resync pattern from physical cube:', err);
    }
  }, [syncPhysicalPattern, setMode]);

  return {
    connect,
    disconnect,
    resyncFromCube,
    hasActiveConnection: () => Boolean(activeSmartPuzzle),
  };
}

