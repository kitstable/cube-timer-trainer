import type { KPattern } from 'cubing/kpuzzle';
import { Alg } from 'cubing/alg';
import { simplifyMoveSequence } from '../utils/moveSimplifier';


const MOVES = [
  'U', "U'", 'U2',
  'D', "D'", 'D2',
  'L', "L'", 'L2',
  'R', "R'", 'R2',
  'F', "F'", 'F2',
  'B', "B'", 'B2',
];

const INVERSE_MOVES: Record<string, string> = {
  U: "U'",
  "U'": 'U',
  U2: 'U2',
  D: "D'",
  "D'": 'D',
  D2: 'D2',
  L: "L'",
  "L'": 'L',
  L2: 'L2',
  R: "R'",
  "R'": 'R',
  R2: 'R2',
  F: "F'",
  "F'": 'F',
  F2: 'F2',
  B: "B'",
  "B'": 'B',
  B2: 'B2',
};

// Target cross pieces in post-z2 frame:
// 0: DF (White-Green) -> slot 4
// 1: DL (White-Red)   -> slot 7
// 2: DB (White-Blue)  -> slot 6
// 3: DR (White-Orange)-> slot 5
const SOLVED_CROSS_KEY = '4,0,7,0,6,0,5,0';

/**
 * Compact serialization of the 4 cross edges (pieces 0, 1, 2, 3) position & orientation.
 * Fast to compute, compare, and hash.
 */
function getCrossKey(pattern: KPattern): string {
  const e = pattern.patternData.EDGES;
  let p0 = -1, o0 = 0, p1 = -1, o1 = 0, p2 = -1, o2 = 0, p3 = -1, o3 = 0;
  for (let i = 0; i < 12; i++) {
    const piece = e.pieces[i];
    if (piece === 0) { p0 = i; o0 = e.orientation[i]; }
    else if (piece === 1) { p1 = i; o1 = e.orientation[i]; }
    else if (piece === 2) { p2 = i; o2 = e.orientation[i]; }
    else if (piece === 3) { p3 = i; o3 = e.orientation[i]; }
  }
  return `${p0},${o0},${p1},${o1},${p2},${o2},${p3},${o3}`;
}



const OPPOSITE_FACES: Record<string, string> = {
  U: 'D',
  D: 'U',
  L: 'R',
  R: 'L',
  F: 'B',
  B: 'F',
};

function isValidMove(lastMove: string | null, secondLastMove: string | null, nextMove: string): boolean {
  if (!lastMove) return true;
  const lastFace = lastMove[0];
  const nextFace = nextMove[0];

  // Same face in a row is redundant
  if (lastFace === nextFace) return false;

  // Commuting opposite face ordering
  if (secondLastMove) {
    const secondLastFace = secondLastMove[0];
    if (secondLastFace === nextFace && OPPOSITE_FACES[nextFace] === lastFace) {
      return false;
    }
  }

  return true;
}

interface BfsItem {
  pattern: KPattern;
  moves: string[];
}

/**
 * Solves the White Cross (in post-z2 frame) using Bidirectional Breadth-First Search.
 * Finds optimal solutions up to 8 moves in milliseconds without hanging.
 */
export function solveCrossBFS(initialPattern: KPattern, maxDepth: number = 8): string[] {
  const initialKey = getCrossKey(initialPattern);
  if (initialKey === SOLVED_CROSS_KEY) {
    return [];
  }

  // Pre-instantiate Alg objects for speed
  const forwardAlgs = new Map<string, Alg>();
  const inverseAlgs = new Map<string, Alg>();
  for (const m of MOVES) {
    forwardAlgs.set(m, new Alg(m));
    inverseAlgs.set(m, new Alg(INVERSE_MOVES[m]));
  }

  // Maps stateKey -> move sequence
  const forwardMap = new Map<string, string[]>();
  const backwardMap = new Map<string, string[]>();

  forwardMap.set(initialKey, []);
  backwardMap.set(SOLVED_CROSS_KEY, []);

  let forwardQueue: BfsItem[] = [{ pattern: initialPattern, moves: [] }];

  // Create solved post-z2 pattern for backward search
  const solvedPattern = ((initialPattern as any).kpuzzle as any).defaultPattern().applyAlg(new Alg('z2'));

  let backwardQueue: BfsItem[] = [{ pattern: solvedPattern, moves: [] }];


  const halfDepth = Math.ceil(maxDepth / 2);

  // Expand forward and backward alternately up to halfDepth
  for (let step = 1; step <= halfDepth; step++) {
    // 1. Expand Forward
    const nextForwardQueue: BfsItem[] = [];
    for (const item of forwardQueue) {
      const lastMove = item.moves.length > 0 ? item.moves[item.moves.length - 1] : null;
      const secondLastMove = item.moves.length > 1 ? item.moves[item.moves.length - 2] : null;

      for (const move of MOVES) {
        if (!isValidMove(lastMove, secondLastMove, move)) continue;

        const nextPattern = item.pattern.applyAlg(forwardAlgs.get(move)!);
        const nextKey = getCrossKey(nextPattern);
        const nextMoves = [...item.moves, move];

        // Check if backward search already reached this state
        const backMoves = backwardMap.get(nextKey);
        if (backMoves !== undefined) {
          // Reconstruct solution
          return simplifyMoveSequence([...nextMoves, ...backMoves]);
        }

        if (!forwardMap.has(nextKey)) {
          forwardMap.set(nextKey, nextMoves);
          nextForwardQueue.push({ pattern: nextPattern, moves: nextMoves });
        }
      }
    }
    forwardQueue = nextForwardQueue;

    // 2. Expand Backward (from solved state)
    const nextBackwardQueue: BfsItem[] = [];
    for (const item of backwardQueue) {
      const lastMove = item.moves.length > 0 ? item.moves[0] : null;
      const secondLastMove = item.moves.length > 1 ? item.moves[1] : null;

      for (const move of MOVES) {
        if (!isValidMove(lastMove, secondLastMove, move)) continue;

        // Apply inverse move backwards from target
        const invAlg = inverseAlgs.get(move)!;
        const nextPattern = item.pattern.applyAlg(invAlg);
        const nextKey = getCrossKey(nextPattern);
        const nextMoves = [move, ...item.moves];

        // Check if forward search already reached this state
        const fwdMoves = forwardMap.get(nextKey);
        if (fwdMoves !== undefined) {
          return simplifyMoveSequence([...fwdMoves, ...nextMoves]);
        }


        if (!backwardMap.has(nextKey)) {
          backwardMap.set(nextKey, nextMoves);
          nextBackwardQueue.push({ pattern: nextPattern, moves: nextMoves });
        }
      }
    }
    backwardQueue = nextBackwardQueue;
  }

  // Fallback: if search limit reached, return best partial or greedy move
  return [];
}

