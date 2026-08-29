import { cube3x3x3 } from 'cubing/puzzles';
import { Alg } from 'cubing/alg';
import type { KPattern, KPuzzle } from 'cubing/kpuzzle';

let cachedKPuzzle: KPuzzle | null = null;
let cachedDefaultPattern: KPattern | null = null;
let cachedPostZ2Pattern: KPattern | null = null;
let cachedSolvedPatterns: KPattern[] = [];

const WHOLE_CUBE_ROTATIONS = [
  '', 'y', "y'", 'y2',
  'x', 'x y', 'x y2', "x y'",
  "x'", "x' y", "x' y2", "x' y'",
  'x2', 'x2 y', 'x2 y2', "x2 y'",
  'z', 'z y', 'z y2', "z y'",
  "z'", "z' y", "z' y2", "z' y'",
];

export async function getKPuzzle(): Promise<KPuzzle> {
  if (!cachedKPuzzle) {
    cachedKPuzzle = await cube3x3x3.kpuzzle();
    cachedDefaultPattern = cachedKPuzzle.defaultPattern();
    cachedPostZ2Pattern = cachedDefaultPattern.applyAlg(new Alg('z2'));

    const solvedList: KPattern[] = [];
    for (const rot of WHOLE_CUBE_ROTATIONS) {
      try {
        const p = rot ? cachedDefaultPattern.applyAlg(new Alg(rot)) : cachedDefaultPattern;
        solvedList.push(p);
      } catch {
        // ignore rotation error
      }
    }
    cachedSolvedPatterns = solvedList;
  }
  return cachedKPuzzle;
}

export function getDefaultPattern(): KPattern {
  if (!cachedDefaultPattern) {
    throw new Error('KPuzzle not yet initialized. Call getKPuzzle() first.');
  }
  return cachedDefaultPattern;
}

export function getPostZ2Pattern(): KPattern {
  if (!cachedPostZ2Pattern) {
    throw new Error('KPuzzle not yet initialized. Call getKPuzzle() first.');
  }
  return cachedPostZ2Pattern;
}

export function applyMoveToPattern(pattern: KPattern, move: string): KPattern {
  try {
    return pattern.applyAlg(new Alg(move));
  } catch (err) {
    console.warn(`Failed to apply move '${move}':`, err);
    return pattern;
  }
}

export function applyAlgToPattern(pattern: KPattern, algStr: string): KPattern {
  if (!algStr.trim()) return pattern;
  try {
    return pattern.applyAlg(new Alg(algStr));
  } catch (err) {
    console.warn(`Failed to apply alg '${algStr}':`, err);
    return pattern;
  }
}

export function isPatternSolved(pattern: any): boolean {
  if (!pattern) return false;
  const pData = pattern.patternData || pattern;
  if (!pData || !pData.EDGES || !pData.CORNERS) return false;

  const e = pData.EDGES;
  const c = pData.CORNERS;

  // 1. Direct identity (default solved orientation)
  const isDefault =
    e.pieces.every((p: number, i: number) => p === i) &&
    e.orientation.every((o: number) => o === 0) &&
    c.pieces.every((p: number, i: number) => p === i) &&
    c.orientation.every((o: number) => o === 0);

  if (isDefault) return true;

  // 2. Post-z2 solved orientation
  const POST_Z2_EDGES = [4, 7, 6, 5, 0, 3, 2, 1, 9, 8, 11, 10];
  const POST_Z2_CORNERS = [5, 6, 7, 4, 3, 0, 1, 2];
  const isPostZ2 =
    e.pieces.every((p: number, i: number) => p === POST_Z2_EDGES[i]) &&
    e.orientation.every((o: number) => o === 0) &&
    c.pieces.every((p: number, i: number) => p === POST_Z2_CORNERS[i]) &&
    c.orientation.every((o: number) => o === 0);

  if (isPostZ2) return true;

  // 3. Check all 24 rotational symmetries if initialized
  if (cachedSolvedPatterns.length > 0) {
    for (const solvedPat of cachedSolvedPatterns) {
      const sData = solvedPat.patternData;
      const match =
        e.pieces.every((p: number, i: number) => p === sData.EDGES.pieces[i]) &&
        e.orientation.every((o: number, i: number) => o === sData.EDGES.orientation[i]) &&
        c.pieces.every((p: number, i: number) => p === sData.CORNERS.pieces[i]) &&
        c.orientation.every((o: number, i: number) => o === sData.CORNERS.orientation[i]);

      if (match) return true;
    }
  }

  return false;
}

export const isCubeSolved = isPatternSolved;

