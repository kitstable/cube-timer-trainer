import { cube3x3x3 } from 'cubing/puzzles';
import { Alg } from 'cubing/alg';
import type { KPattern, KPuzzle } from 'cubing/kpuzzle';

let cachedKPuzzle: KPuzzle | null = null;
let cachedDefaultPattern: KPattern | null = null;
let cachedPostZ2Pattern: KPattern | null = null;
let cachedSolvedPatterns: KPattern[] = [];

export const WHOLE_CUBE_ROTATIONS = [
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

/** Face relabel across a z2 whole-cube rotation: U<->D, L<->R, F/B fixed. */
const Z2_FACE_RELABEL: Record<string, string> = { U: 'D', D: 'U', L: 'R', R: 'L', F: 'F', B: 'B' };

/**
 * Relabel a single face-turn token across a z2 rotation (`R2` -> `L2`, `U'` -> `D'`).
 * Modifiers are untouched; whole-cube rotations, slices and unrecognised tokens pass
 * through unchanged. Used to bring smart-cube move events (reported in the cube's
 * calibrated / default frame) into the app's post-z2 CFOP frame for phase detection.
 */
export function relabelMoveZ2(move: string): string {
  const m = move.trim();
  const face = m.charAt(0).toUpperCase();
  const mapped = Z2_FACE_RELABEL[face];
  return mapped ? mapped + m.slice(1) : move;
}

/**
 * A single plain outer face turn: `U` `D` `L` `R` `F` `B` with an optional `'`, `2`, or
 * `2'` / `'2` modifier. Nothing else — no wide moves, slices, whole-cube rotations, or
 * parenthesised groups.
 */
const FACE_TURN_TOKEN = /^[UDLRFB](?:2'|'2|2|')?$/;

/** True iff every whitespace-separated token in `alg` is a plain outer face turn. `''` → true. */
export function isAllFaceTurns(alg: string): boolean {
  const t = alg.trim();
  if (!t) return true;
  return t.split(/\s+/).every((tok) => FACE_TURN_TOKEN.test(tok));
}

/**
 * Relabel a raw / library-default (white-up) **face-turn** alg string into the post-z2
 * (yellow-up) *display* frame, token by token via the already-tested `relabelMoveZ2`
 * (U↔D, L↔R, F/B fixed, direction preserved — z2 is a proper rotation).
 *
 * The identity that makes the wiring physically correct (proven for face-turn algs in
 * `src/tests/toZ2DisplayAlg.test.ts`):
 *
 *   solved · z2 · toZ2DisplayAlg(X)   ==   solved · X · z2
 *
 * i.e. `experimentalSetupAlg="z2"` + `alg=toZ2DisplayAlg(rawMoves)` shows exactly the real
 * raw-frame cube state, viewed after tipping the whole cube over by z2 (yellow on top).
 *
 * **DISPLAY-ONLY.** Feed the result only to `<twisty-player>`. Never round-trip it through
 * `useCubeStore` / the solver / the move trackers / persistence — those all stay in the raw
 * frame by design.
 *
 * **Limitation (callers must gate on `isAllFaceTurns`):** `relabelMoveZ2` passes slice, wide
 * and whole-cube-rotation tokens through *unchanged*, which is NOT the z2 conjugation for
 * them (`z2 · y · z2` is `y'`, not `y`). `visualAlg` can end with a rotation token when a
 * smart cube reports `getPattern()` in a rotated whole-cube orientation (see
 * `reconstructAlgForPattern`). In that case the caller must fall back to the untransformed
 * raw view rather than mis-relabel — this is deliberate defensive behaviour, since a
 * mis-transformed rotated frame is exactly the class of bug that reverted this feature once
 * before (commit 2e819f9).
 */
export function toZ2DisplayAlg(rawAlgString: string): string {
  const t = rawAlgString.trim();
  if (!t) return '';
  return t.split(/\s+/).map(relabelMoveZ2).join(' ');
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

