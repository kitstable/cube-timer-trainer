import type { KPattern } from 'cubing/kpuzzle';
import { Alg } from 'cubing/alg';
import type { CFOPPhase, F2LSlotId, PhaseStatus } from '../types/cube';
import { CFOP_PHASE_ORDER } from './constants';
import { getKPuzzle, isPatternSolved } from './kpuzzleHelper';
import {
  isCrossSolved as crossSolved,
  isOLLSolved as ollSolved,
  isFullySolved as fullySolved,
  solvedSlots as detectSolvedSlots,
  SOLVED_EDGE_PIECES,
  SOLVED_CORNER_PIECES,
} from '../solver/cfopInvariants';


/**
 * Evaluates a KPattern synchronously against CFOP criteria.
 * Fast, pure (no lazy-global dependency), and non-blocking for per-move use.
 */
export function evaluateCFOPFromPattern(pattern: KPattern): PhaseStatus {
  const isSolved = fullySolved(pattern) || isPatternSolved(pattern);
  if (isSolved) {
    return {
      isCrossSolved: true,
      solvedSlots: ['FR', 'FL', 'BR', 'BL'],
      isF2LSolved: true,
      isOLLSolved: true,
      isPLLSolved: true,
      isFullySolved: true,
      currentPhase: 'solved',
    };
  }

  const isCrossSolved = crossSolved(pattern);
  const solvedSlots = detectSolvedSlots(pattern) as F2LSlotId[];
  const isF2LSolved = isCrossSolved && solvedSlots.length === 4;
  const isOLLSolved = ollSolved(pattern);
  const isFullySolved = false;

  // PLL: OLL solved and the last layer is permuted up to an AUF (U / U' / U2).
  let isPLLSolved = isFullySolved;
  if (isOLLSolved && !isFullySolved) {
    for (const auf of ['U', "U'", 'U2']) {
      const aufPattern = pattern.applyAlg(new Alg(auf));
      const e = aufPattern.patternData.EDGES;
      const c = aufPattern.patternData.CORNERS;
      if (
        e.pieces.every((p: number, i: number) => p === SOLVED_EDGE_PIECES[i]) &&
        c.pieces.every((p: number, i: number) => p === SOLVED_CORNER_PIECES[i])
      ) {
        isPLLSolved = true;
        break;
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
