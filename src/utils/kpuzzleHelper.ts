import { cube3x3x3 } from 'cubing/puzzles';
import { Alg } from 'cubing/alg';
import type { KPattern, KPuzzle } from 'cubing/kpuzzle';

let cachedKPuzzle: KPuzzle | null = null;
let cachedDefaultPattern: KPattern | null = null;
let cachedPostZ2Pattern: KPattern | null = null;

export async function getKPuzzle(): Promise<KPuzzle> {
  if (!cachedKPuzzle) {
    cachedKPuzzle = await cube3x3x3.kpuzzle();
    cachedDefaultPattern = cachedKPuzzle.defaultPattern();
    cachedPostZ2Pattern = cachedDefaultPattern.applyAlg(new Alg('z2'));
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

export function isPatternSolved(pattern: KPattern): boolean {
  if (!cachedDefaultPattern || !cachedPostZ2Pattern) return false;
  const e = pattern.patternData.EDGES;
  const c = pattern.patternData.CORNERS;

  // Check default solved
  const defE = cachedDefaultPattern.patternData.EDGES;
  const defC = cachedDefaultPattern.patternData.CORNERS;
  const isDefault =
    e.pieces.every((p, i) => p === defE.pieces[i]) &&
    e.orientation.every((o, i) => o === defE.orientation[i]) &&
    c.pieces.every((p, i) => p === defC.pieces[i]) &&
    c.orientation.every((o, i) => o === defC.orientation[i]);

  if (isDefault) return true;

  // Check post-z2 solved
  const targetE = cachedPostZ2Pattern.patternData.EDGES;
  const targetC = cachedPostZ2Pattern.patternData.CORNERS;
  const isPostZ2 =
    e.pieces.every((p, i) => p === targetE.pieces[i]) &&
    e.orientation.every((o, i) => o === targetE.orientation[i]) &&
    c.pieces.every((p, i) => p === targetC.pieces[i]) &&
    c.orientation.every((o, i) => o === targetC.orientation[i]);

  return isPostZ2;
}
