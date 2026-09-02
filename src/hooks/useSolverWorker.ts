import { useEffect, useState, useCallback } from 'react';
import type { SolverWorkerRequest, SolverWorkerResponse } from '../types/solver';
import type { TechniqueTier, NotationMode } from '../types/cube';
import algorithmData from '../data/cfop-algorithms.json';




let sharedWorker: Worker | null = null;
let isWorkerReady = false;
const readyListeners = new Set<(ready: boolean) => void>();
const pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();

function getSharedWorker(): Worker {
  if (!sharedWorker && typeof window !== 'undefined') {
    sharedWorker = new Worker(
      new URL('../solver/solverWorker.ts', import.meta.url),
      { type: 'module' }
    );

    sharedWorker.onmessage = (e: MessageEvent<SolverWorkerResponse>) => {
      const res = e.data;

      if (res.type === 'DATABASE_INITIALIZED') {
        isWorkerReady = true;
        readyListeners.forEach((fn) => fn(true));
        const cb = pendingRequests.get('INIT');
        if (cb) {
          cb.resolve(true);
          pendingRequests.delete('INIT');
        }
      } else if (res.type === 'SCRAMBLE_GENERATED') {
        const cb = pendingRequests.get('SCRAMBLE');
        if (cb) {
          cb.resolve({ scramble: res.scramble, moves: res.moves });
          pendingRequests.delete('SCRAMBLE');
        }
      } else if (res.type === 'CROSS_SOLVED') {
        const cb = pendingRequests.get('CROSS');
        if (cb) {
          cb.resolve({ moves: res.moves, description: res.description });
          pendingRequests.delete('CROSS');
        }
      } else if (res.type === 'HINT_FOUND') {
        const cb = pendingRequests.get('HINT');
        if (cb) {
          cb.resolve(res);
          pendingRequests.delete('HINT');
        }
      } else if (res.type === 'ALG_RECONSTRUCTED') {
        const cb = pendingRequests.get('RECONSTRUCT');
        if (cb) {
          cb.resolve(res.alg);
          pendingRequests.delete('RECONSTRUCT');
        }
      } else if (res.type === 'TRAINING_SCRAMBLE_GENERATED') {
        const cb = pendingRequests.get('TRAINING_SCRAMBLE');
        if (cb) {
          cb.resolve({
            moves: res.moves,
            caseName: res.caseName,
            subset: res.subset,
            algorithm: res.algorithm,
            algorithmSimplified: res.algorithmSimplified,
            targetSlot: res.targetSlot,
          });
          pendingRequests.delete('TRAINING_SCRAMBLE');
        }
      } else if (res.type === 'ERROR') {
        console.error('Solver worker error:', res.message);
        for (const [key, cb] of pendingRequests.entries()) {
          cb.reject(new Error(res.message));
          pendingRequests.delete(key);
        }
      }
    };

    // Initialize algorithm database
    sharedWorker.postMessage({
      type: 'INIT_DATABASE',
      payload: algorithmData as any,
    } satisfies SolverWorkerRequest);
  }

  return sharedWorker!;
}

// Start worker initialization eagerly on module load
if (typeof window !== 'undefined') {
  getSharedWorker();
}

export function useSolverWorker() {
  const [isReady, setIsReady] = useState(isWorkerReady);

  useEffect(() => {
    getSharedWorker();

    if (isWorkerReady) {
      setIsReady(true);
      return;
    }

    const listener = (ready: boolean) => setIsReady(ready);
    readyListeners.add(listener);
    return () => {
      readyListeners.delete(listener);
    };
  }, []);

  const generateScramble = useCallback((): Promise<{ scramble: string; moves: string[] }> => {
    return new Promise((resolve, reject) => {
      const worker = getSharedWorker();
      pendingRequests.set('SCRAMBLE', { resolve, reject });
      worker.postMessage({ type: 'GENERATE_SCRAMBLE' } satisfies SolverWorkerRequest);
    });
  }, []);

  const solveCross = useCallback((patternData: any): Promise<{ moves: string[]; description?: string }> => {
    return new Promise((resolve, reject) => {
      const worker = getSharedWorker();
      pendingRequests.set('CROSS', { resolve, reject });
      worker.postMessage({ type: 'SOLVE_CROSS', patternData } satisfies SolverWorkerRequest);
    });
  }, []);

  const findHint = useCallback(
    (
      phase: string,
      patternData: any,
      activeSlot?: string,
      techniqueTier?: TechniqueTier,
      notationMode?: NotationMode
    ): Promise<any> => {
      return new Promise((resolve, reject) => {
        const worker = getSharedWorker();
        pendingRequests.set('HINT', { resolve, reject });
        worker.postMessage({
          type: 'FIND_HINT',
          phase,
          patternData,
          activeSlot,
          techniqueTier,
          notationMode,
        } satisfies SolverWorkerRequest);
      });
    },
    []
  );




  const generateTrainingScramble = useCallback(
    (
      caseSource: 'OLL' | 'PLL' | 'F2L' | 'OLL_2LOOK_EDGE',
      caseNames: string[]
    ): Promise<{
      moves: string[];
      caseName: string;
      subset: string;
      algorithm: string;
      algorithmSimplified: string;
      targetSlot?: string;
    }> => {
      return new Promise((resolve, reject) => {
        const worker = getSharedWorker();
        pendingRequests.set('TRAINING_SCRAMBLE', { resolve, reject });
        worker.postMessage({
          type: 'GENERATE_TRAINING_SCRAMBLE',
          caseSource,
          caseNames,
        } satisfies SolverWorkerRequest);
      });
    },
    []
  );

  const reconstructAlg = useCallback((patternData: any): Promise<string> => {
    return new Promise((resolve, reject) => {
      const worker = getSharedWorker();
      pendingRequests.set('RECONSTRUCT', { resolve, reject });
      worker.postMessage({ type: 'RECONSTRUCT_ALG', patternData } satisfies SolverWorkerRequest);
    });
  }, []);

  return {
    isReady,
    generateScramble,
    solveCross,
    findHint,
    reconstructAlg,
    generateTrainingScramble,
  };
}

