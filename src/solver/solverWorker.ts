import { cube3x3x3 } from 'cubing/puzzles';
import { randomScrambleForEvent } from 'cubing/scramble';
import type { KPuzzle, KPattern } from 'cubing/kpuzzle';
import { CaseMatcher } from './caseMatcher';
import { solveCrossBFS } from './crossBfs';
import type { SolverWorkerRequest, SolverWorkerResponse } from '../types/solver';



let kpInstance: KPuzzle | null = null;
let caseMatcher: CaseMatcher | null = null;

async function initSolver(): Promise<KPuzzle> {
  if (!kpInstance) {
    kpInstance = await cube3x3x3.kpuzzle();
    caseMatcher = new CaseMatcher(kpInstance);
  }
  return kpInstance;
}

self.onmessage = async (e: MessageEvent<SolverWorkerRequest>) => {
  const req = e.data;

  try {
    const kp = await initSolver();

    switch (req.type) {
      case 'INIT_DATABASE': {
        if (caseMatcher) {
          caseMatcher.initialize(req.payload);
        }
        self.postMessage({ type: 'DATABASE_INITIALIZED' } satisfies SolverWorkerResponse);
        break;
      }

      case 'GENERATE_SCRAMBLE': {
        const scrambleObj = await randomScrambleForEvent('333');
        const scramble = scrambleObj.toString();
        const moves = Array.from(scrambleObj.experimentalLeafMoves()).map((m) => m.toString());
        self.postMessage({
          type: 'SCRAMBLE_GENERATED',
          scramble,
          moves,
        } satisfies SolverWorkerResponse);
        break;
      }

      case 'SOLVE_CROSS': {
        const pattern = new (kp.defaultPattern().constructor as any)(kp, req.patternData) as KPattern;
        const moves = solveCrossBFS(pattern, 8);
        self.postMessage({
          type: 'CROSS_SOLVED',
          moves,
          description: moves.length > 0 ? `Optimal ${moves.length}-move white cross` : 'Cross is already solved',
        } satisfies SolverWorkerResponse);
        break;
      }

      case 'FIND_HINT': {
        const pattern = new (kp.defaultPattern().constructor as any)(kp, req.patternData) as KPattern;
        let phase = req.phase;
        const tier = req.techniqueTier || req.tier || '2look';
        const notationMode = req.notationMode || 'simplified';
        const preferRotationless = tier === 'fullPLL' || tier === 'fullCFOP' || tier === 'confident';
        const is1LookOLL = tier === 'fullCFOP';
        const is1LookPLL = tier === 'fullPLL' || tier === 'fullCFOP' || tier === 'confident';

        // 1. Cross phase check
        if (phase === 'cross') {
          const crossMoves = solveCrossBFS(pattern);
          self.postMessage({
            type: 'HINT_FOUND',
            phase: 'cross',
            moves: crossMoves,
            caseName: 'White Cross',
          } satisfies SolverWorkerResponse);
          break;
        }

        // 2. F2L phase check
        if (phase.startsWith('f2l')) {
          let match = caseMatcher
            ? caseMatcher.matchF2L(pattern, req.activeSlot, preferRotationless, notationMode)
            : null;

          if (!match && caseMatcher) {
            match = caseMatcher.matchIntuitiveF2L(pattern, req.activeSlot);
          }

          if (match && match.moves.length > 0) {
            self.postMessage({
              type: 'HINT_FOUND',
              phase,
              moves: match.moves,
              caseName: match.caseName,
              subset: match.subset,
              targetSlot: match.targetSlot,
            } satisfies SolverWorkerResponse);
            break;
          }

          // If no direct match, provide slot-specific extraction
          const defaultSlotMoves: Record<string, string[]> = {
            FR: ['R', 'U', "R'"],
            FL: ["L'", "U'", 'L'],
            BR: ["R'", "U'", 'R'],
            BL: ['L', 'U', "L'"],
          };
          const targetSlot = req.activeSlot || 'FR';
          const fallbackMoves = defaultSlotMoves[targetSlot] || defaultSlotMoves.FR;

          self.postMessage({
            type: 'HINT_FOUND',
            phase,
            moves: fallbackMoves,
            caseName: `Intuitive F2L · Extract pieces to top layer (${targetSlot} Slot)`,
            targetSlot,
          } satisfies SolverWorkerResponse);
          break;
        }

        // 3. OLL phase check
        if (phase === 'oll') {
          const match = caseMatcher
            ? is1LookOLL
              ? caseMatcher.matchOLL(pattern, notationMode)
              : caseMatcher.match2LookOLL(pattern, notationMode)
            : null;

          if (match && match.moves.length > 0) {
            self.postMessage({
              type: 'HINT_FOUND',
              phase: 'oll',
              moves: match.moves,
              caseName: match.caseName,
              subset: match.subset,
            } satisfies SolverWorkerResponse);
            break;
          } else if (match && match.moves.length === 0) {
            // OLL Complete / Skip, proceed to PLL
            phase = 'pll';
          } else {
            self.postMessage({
              type: 'HINT_FOUND',
              phase: 'oll',
              moves: ['F', 'R', 'U', "R'", "U'", "F'"],
              caseName: is1LookOLL ? 'OLL FRURUF' : '2-Look OLL · Yellow Cross (F R U R\' U\' F\')',
            } satisfies SolverWorkerResponse);
            break;
          }
        }

        // 4. PLL phase check
        if (phase === 'pll' || phase === 'auf') {
          const match = caseMatcher
            ? is1LookPLL
              ? caseMatcher.matchPLL(pattern, notationMode)
              : caseMatcher.match2LookPLL(pattern, notationMode)
            : null;

          if (match && match.moves.length > 0) {
            self.postMessage({
              type: 'HINT_FOUND',
              phase: 'pll',
              moves: match.moves,
              caseName: match.caseName,
              subset: match.subset,
            } satisfies SolverWorkerResponse);
            break;
          } else if (match && match.moves.length === 0) {
            // Solved!
            self.postMessage({
              type: 'HINT_FOUND',
              phase: 'solved',
              moves: [],
              caseName: 'Cube Solved!',
            } satisfies SolverWorkerResponse);
            break;
          } else {
            self.postMessage({
              type: 'HINT_FOUND',
              phase: 'pll',
              moves: ['R', 'U', "R'", "U'", "R'", 'F', 'R2', "U'", "R'", "U'", 'R', 'U', "R'", "F'"],
              caseName: 'PLL Headlights (T-Perm)',
            } satisfies SolverWorkerResponse);
            break;
          }
        }
        break;
      }




      default:
        break;
    }
  } catch (err: any) {
    self.postMessage({
      type: 'ERROR',
      message: err?.message || String(err),
    } satisfies SolverWorkerResponse);
  }
};
