import { cube3x3x3 } from 'cubing/puzzles';
import { randomScrambleForEvent } from 'cubing/scramble';
import type { KPuzzle, KPattern } from 'cubing/kpuzzle';
import { CaseMatcher } from './caseMatcher';
import { solveCrossBFS } from './crossBfs';
import { findHint } from './findHint';
import type { SolverWorkerRequest, SolverWorkerResponse } from '../types/solver';



let kpInstance: KPuzzle | null = null;
let caseMatcher: CaseMatcher | null = null;

// Loop guard: remember the last hint we handed out for a given situation so we
// never emit the same non-progressing sequence twice in a row.
let lastHint: { key: string; moves: string } | null = null;

function hintKey(phase: string, activeSlot: string | undefined, pattern: KPattern): string {
  const e = pattern.patternData.EDGES;
  const c = pattern.patternData.CORNERS;
  return `${phase}|${activeSlot ?? ''}|${e.pieces.join(',')}|${e.orientation.join(',')}|${c.pieces.join(',')}|${c.orientation.join(',')}`;
}

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
        const key = hintKey(req.phase, req.activeSlot, pattern);
        // If the same situation asked again would replay the exact sequence we
        // just gave (it clearly didn't advance anything), skip the matchers and
        // go straight to the guaranteed full-solve fallback.
        const forceFallback = lastHint !== null && lastHint.key === key;

        const result = await findHint(caseMatcher, pattern, req, forceFallback);
        lastHint = { key, moves: result.moves.join(' ') };

        self.postMessage({
          type: 'HINT_FOUND',
          phase: result.phase,
          moves: result.moves,
          caseName: result.caseName,
          subset: result.subset,
          targetSlot: result.targetSlot,
        } satisfies SolverWorkerResponse);
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
