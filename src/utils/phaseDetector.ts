import type { KPattern } from 'cubing/kpuzzle';
import { Alg } from 'cubing/alg';
import type { CFOPPhase, F2LSlotId, PhaseStatus } from '../types/cube';
import { CFOP_PHASE_ORDER, ALL_F2L_SLOTS } from './constants';
import { getPostZ2Pattern, getKPuzzle } from './kpuzzleHelper';

// In post-z2 frame (White on D, Yellow on U, Green on F, Blue on B, Red on L, Orange on R):
const CROSS_EDGES = [
  { slot: 4, targetPiece: 0 }, // DF: White-Green
  { slot: 5, targetPiece: 3 }, // DR: White-Orange
  { slot: 6, targetPiece: 2 }, // DB: White-Blue
  { slot: 7, targetPiece: 1 }, // DL: White-Red
];

const F2L_SLOT_TARGETS: Record<
  F2LSlotId,
  {
    cornerSlot: number;
    cornerPiece: number;
    edgeSlot: number;
    edgePiece: number;
  }
> = {
  FR: { cornerSlot: 4, cornerPiece: 3, edgeSlot: 8, edgePiece: 9 }, // DFR corner + FR edge
  FL: { cornerSlot: 5, cornerPiece: 0, edgeSlot: 9, edgePiece: 8 }, // DFL corner + FL edge
  BL: { cornerSlot: 6, cornerPiece: 1, edgeSlot: 10, edgePiece: 11 }, // DBL corner + BL edge
  BR: { cornerSlot: 7, cornerPiece: 2, edgeSlot: 11, edgePiece: 10 }, // DBR corner + BR edge
};


/**
 * Evaluates a KPattern synchronously against CFOP criteria.
 * Fast, pure, and non-blocking for per-move evaluation.
 */
export function evaluateCFOPFromPattern(pattern: KPattern): PhaseStatus {
  const edges = pattern.patternData.EDGES;
  const corners = pattern.patternData.CORNERS;

  // 1. Cross Check: 4 bottom edges in place and oriented (ori === 0)
  const isCrossSolved = CROSS_EDGES.every(
    ({ slot, targetPiece }) =>
      edges.pieces[slot] === targetPiece && edges.orientation[slot] === 0
  );

  // 2. F2L Slots Check
  const solvedSlots: F2LSlotId[] = [];
  for (const slotId of ALL_F2L_SLOTS) {
    const target = F2L_SLOT_TARGETS[slotId];
    const cornerMatches =
      corners.pieces[target.cornerSlot] === target.cornerPiece &&
      corners.orientation[target.cornerSlot] === 0;
    const edgeMatches =
      edges.pieces[target.edgeSlot] === target.edgePiece &&
      edges.orientation[target.edgeSlot] === 0;

    if (cornerMatches && edgeMatches) {
      solvedSlots.push(slotId);
    }
  }

  const isF2LSolved = isCrossSolved && solvedSlots.length === 4;

  // 3. OLL Check: F2L solved + all 4 top edges and 4 top corners oriented (ori === 0)
  const isOLLSolved =
    isF2LSolved &&
    edges.orientation[0] === 0 &&
    edges.orientation[1] === 0 &&
    edges.orientation[2] === 0 &&
    edges.orientation[3] === 0 &&
    corners.orientation[0] === 0 &&
    corners.orientation[1] === 0 &&
    corners.orientation[2] === 0 &&
    corners.orientation[3] === 0;

  // 4. Solved check: full match with post-z2 target
  let isFullySolved = false;
  try {
    const target = getPostZ2Pattern();
    const targetEdges = target.patternData.EDGES;
    const targetCorners = target.patternData.CORNERS;

    isFullySolved =
      isOLLSolved &&
      edges.pieces.every((p, i) => p === targetEdges.pieces[i]) &&
      corners.pieces.every((p, i) => p === targetCorners.pieces[i]);
  } catch {
    isFullySolved = false;
  }

  // 5. PLL Check: OLL solved and top layer permutation is solved up to AUF (none, U, U', U2)
  let isPLLSolved = isFullySolved;
  if (isOLLSolved && !isFullySolved) {
    for (const auf of ['U', "U'", 'U2']) {
      try {
        const aufPattern = pattern.applyAlg(new Alg(auf));
        const e = aufPattern.patternData.EDGES;
        const c = aufPattern.patternData.CORNERS;
        const target = getPostZ2Pattern();
        const targetE = target.patternData.EDGES;
        const targetC = target.patternData.CORNERS;

        if (
          e.pieces.every((p, i) => p === targetE.pieces[i]) &&
          c.pieces.every((p, i) => p === targetC.pieces[i])
        ) {
          isPLLSolved = true;
          break;
        }
      } catch {
        // ignore
      }
    }
  }

  // Determine current active phase
  let currentPhase: CFOPPhase = 'cross';
  if (isFullySolved) {
    currentPhase = 'solved';
  } else if (isPLLSolved) {
    currentPhase = 'auf';
  } else if (isOLLSolved) {
    currentPhase = 'pll';
  } else if (isF2LSolved) {
    currentPhase = 'oll';
  } else if (isCrossSolved) {
    const count = solvedSlots.length;
    currentPhase =
      count === 0
        ? 'f2l-1'
        : count === 1
        ? 'f2l-2'
        : count === 2
        ? 'f2l-3'
        : 'f2l-4';
  }

  return {
    isCrossSolved,
    solvedSlots,
    isF2LSolved,
    isOLLSolved,
    isPLLSolved,
    isFullySolved,
    currentPhase,
  };
}

export function phaseRank(phase: CFOPPhase): number {
  const idx = CFOP_PHASE_ORDER.indexOf(phase);
  return idx >= 0 ? idx : 0;
}

/**
 * Ensures monotonic phase progression so intermediate turn states do not
 * flicker or regress the current phase during speed solves.
 */
export function resolveMonotonicCFOPPhase(
  currentHighestPhase: CFOPPhase,
  previouslySolvedSlots: F2LSlotId[],
  snapshot: PhaseStatus
): {
  phase: CFOPPhase;
  solvedSlots: F2LSlotId[];
} {
  if (snapshot.isFullySolved) {
    return {
      phase: 'solved',
      solvedSlots:
        previouslySolvedSlots.length === 4
          ? previouslySolvedSlots
          : ['FR', 'FL', 'BR', 'BL'],
    };
  }

  let nextPhase = currentHighestPhase;
  const accumulatedSlots: F2LSlotId[] = [...previouslySolvedSlots];

  for (const slot of snapshot.solvedSlots) {
    if (!accumulatedSlots.includes(slot)) {
      accumulatedSlots.push(slot);
    }
  }

  // Cross -> F2L transition
  if (
    phaseRank(nextPhase) <= phaseRank('cross') &&
    (snapshot.isCrossSolved || accumulatedSlots.length > 0)
  ) {
    nextPhase = 'f2l-1';
  }

  // F2L progression
  if (
    phaseRank(nextPhase) >= phaseRank('f2l-1') &&
    phaseRank(nextPhase) <= phaseRank('f2l-4')
  ) {
    const slotCount = Math.max(accumulatedSlots.length, snapshot.solvedSlots.length);
    if (snapshot.isF2LSolved || slotCount >= 4) {
      nextPhase = 'oll';
    } else if (slotCount === 3 && phaseRank(nextPhase) < phaseRank('f2l-4')) {
      nextPhase = 'f2l-4';
    } else if (slotCount === 2 && phaseRank(nextPhase) < phaseRank('f2l-3')) {
      nextPhase = 'f2l-3';
    } else if (slotCount === 1 && phaseRank(nextPhase) < phaseRank('f2l-2')) {
      nextPhase = 'f2l-2';
    }
  }

  // OLL -> PLL transition
  if (phaseRank(nextPhase) === phaseRank('oll')) {
    if (snapshot.isOLLSolved) {
      nextPhase = 'pll';
    }
  }

  // PLL -> AUF transition
  if (phaseRank(nextPhase) === phaseRank('pll')) {
    if (snapshot.isPLLSolved) {
      nextPhase = 'auf';
    }
  }

  return {
    phase: nextPhase,
    solvedSlots: accumulatedSlots,
  };
}

/**
 * Replays moves from a scramble + z2 to evaluate snapshot.
 */
export async function evaluateCFOPFromMoves(
  scrambleAlg: string,
  moves: string[]
): Promise<PhaseStatus> {
  const kp = await getKPuzzle();
  const fullAlgStr = `${scrambleAlg} z2 ${moves.join(' ')}`.trim();
  const pattern = kp.defaultPattern().applyAlg(new Alg(fullAlgStr));
  return evaluateCFOPFromPattern(pattern);
}
