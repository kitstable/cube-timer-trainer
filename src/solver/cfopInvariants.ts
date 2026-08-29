/**
 * Shared, pure CFOP invariant checks against a cubing.js pattern in the
 * app's fixed "post-z2" frame (White on D, Yellow on U, Green on F).
 *
 * This is the single source of truth for piece indices used by phase
 * detection, the case matcher, the guaranteed fallback solver, and the
 * offline algorithm-data generator. Keep it dependency-light: it only
 * reads `patternData` (`{ EDGES: {pieces, orientation}, CORNERS: {...} }`).
 */

export type F2LSlot = 'FR' | 'FL' | 'BL' | 'BR';

export interface PieceArrays {
  pieces: number[];
  orientation: number[];
}
export interface CubePatternData {
  EDGES: PieceArrays;
  CORNERS: PieceArrays;
}

/**
 * Either a `KPattern` (has `.patternData`) or a raw `patternData` object.
 * Typed loosely because cubing.js's `KPatternData` is a string-indexed record
 * that doesn't statically expose the EDGES/CORNERS orbits.
 */
export type PatternLike = { patternData: any } | CubePatternData | any;

function data(p: PatternLike): CubePatternData {
  return p && p.patternData ? p.patternData : p;
}

/** Cross edges in the post-z2 frame: [edgeSlotIndex, targetPieceId]. */
export const CROSS_EDGES: ReadonlyArray<readonly [number, number]> = [
  [4, 0], // DF: White-Green
  [5, 3], // DR: White-Orange
  [6, 2], // DB: White-Blue
  [7, 1], // DL: White-Red
];

// Verified against single-move piece movement in cubing.js's 3x3x3 def
// (post-z2 frame): D-layer corner slots 4=DFR 5=DFL 6=DBL 7=DBR;
// E-slice edge slots 8=FR 9=FL 10=BR 11=BL. The old phaseDetector table had
// the BL/BR edge slots swapped, which corrupted back-slot F2L detection.
export const F2L_SLOT_TARGETS: Record<
  F2LSlot,
  { cornerSlot: number; cornerPiece: number; edgeSlot: number; edgePiece: number }
> = {
  FR: { cornerSlot: 4, cornerPiece: 3, edgeSlot: 8, edgePiece: 9 },
  FL: { cornerSlot: 5, cornerPiece: 0, edgeSlot: 9, edgePiece: 8 },
  BL: { cornerSlot: 6, cornerPiece: 1, edgeSlot: 11, edgePiece: 10 },
  BR: { cornerSlot: 7, cornerPiece: 2, edgeSlot: 10, edgePiece: 11 },
};

/** Slot order used app-wide as the default F2L solve preference. */
export const ALL_F2L_SLOTS: readonly F2LSlot[] = ['FR', 'FL', 'BR', 'BL'];

/** The solved cube in the app's post-z2 frame (White on D). */
export const SOLVED_EDGE_PIECES = [4, 7, 6, 5, 0, 3, 2, 1, 9, 8, 11, 10];
export const SOLVED_CORNER_PIECES = [5, 6, 7, 4, 3, 0, 1, 2];

export function isCrossSolved(p: PatternLike): boolean {
  const e = data(p).EDGES;
  return CROSS_EDGES.every(([slot, piece]) => e.pieces[slot] === piece && e.orientation[slot] === 0);
}

export function isSlotSolved(p: PatternLike, slot: F2LSlot): boolean {
  const d = data(p);
  const t = F2L_SLOT_TARGETS[slot];
  return (
    d.CORNERS.pieces[t.cornerSlot] === t.cornerPiece &&
    d.CORNERS.orientation[t.cornerSlot] === 0 &&
    d.EDGES.pieces[t.edgeSlot] === t.edgePiece &&
    d.EDGES.orientation[t.edgeSlot] === 0
  );
}

export function solvedSlots(p: PatternLike): F2LSlot[] {
  return ALL_F2L_SLOTS.filter((s) => isSlotSolved(p, s));
}

/** F2L (bottom two layers) complete: cross + all four slots. */
export function isF2LSolved(p: PatternLike): boolean {
  return isCrossSolved(p) && ALL_F2L_SLOTS.every((s) => isSlotSolved(p, s));
}

/** Top layer fully oriented (OLL done), given F2L is already solved. */
export function isOLLSolved(p: PatternLike): boolean {
  const d = data(p);
  return (
    isF2LSolved(p) &&
    d.EDGES.orientation[0] === 0 &&
    d.EDGES.orientation[1] === 0 &&
    d.EDGES.orientation[2] === 0 &&
    d.EDGES.orientation[3] === 0 &&
    d.CORNERS.orientation[0] === 0 &&
    d.CORNERS.orientation[1] === 0 &&
    d.CORNERS.orientation[2] === 0 &&
    d.CORNERS.orientation[3] === 0
  );
}

/** Every edge and corner home and oriented (post-z2 solved). Pure — no globals. */
export function isFullySolved(p: PatternLike): boolean {
  const d = data(p);
  return (
    d.EDGES.pieces.every((v, i) => v === SOLVED_EDGE_PIECES[i]) &&
    d.EDGES.orientation.every((o) => o === 0) &&
    d.CORNERS.pieces.every((v, i) => v === SOLVED_CORNER_PIECES[i]) &&
    d.CORNERS.orientation.every((o) => o === 0)
  );
}

/**
 * Whether `after` still has cross solved and every slot that was solved in
 * `before` still solved. Used to reject a candidate F2L "solution" that
 * makes progress on its target slot only by wrecking earlier work.
 */
export function preservesProgress(before: PatternLike, after: PatternLike): boolean {
  if (!isCrossSolved(after)) return false;
  for (const s of ALL_F2L_SLOTS) {
    if (isSlotSolved(before, s) && !isSlotSolved(after, s)) return false;
  }
  return true;
}
