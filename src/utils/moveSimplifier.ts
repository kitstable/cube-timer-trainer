/**
 * Mathematical Move Simplifier & Cancellation Utility
 *
 * Merges consecutive redundant turns on the same face (e.g., U2 + U' -> U, U' + U' -> U2, R + R' -> 0)
 * and across commuting opposite parallel faces (e.g., U + D + U' -> D).
 */

const OPPOSITE_FACES: Record<string, string> = {
  U: 'D',
  D: 'U',
  L: 'R',
  R: 'L',
  F: 'B',
  B: 'F',
};

interface MoveToken {
  face: string;
  amount: number; // 1 = 90° CW, 2 = 180°, 3 = 90° CCW (-1)
  originalStr: string;
  mergeable?: boolean;
}

// Single-face outer turns that are safe to merge AND commute across an opposite
// face. Everything else (wide moves, slices, whole-cube rotations, anything
// unrecognised) is parsed just enough to cancel a literal repeat, but is never
// treated as commuting — it acts as an opaque barrier in the sequence.
const MERGEABLE_FACE = /^([UDFBLR])('2|2'|2|')?$/;
const ANY_TOKEN = /^([a-zA-Z]+)('2|2'|2|')?$/;

function parseMoveToken(moveStr: string): (MoveToken & { mergeable: boolean }) | null {
  const trimmed = moveStr.trim();
  if (!trimmed) return null;

  const strict = trimmed.match(MERGEABLE_FACE);
  const match = strict || trimmed.match(ANY_TOKEN);
  if (!match) {
    return { face: trimmed, amount: 1, originalStr: trimmed, mergeable: false };
  }

  const face = match[1];
  const suffix = match[2] || '';
  let amount = 1;
  if (suffix === '2' || suffix === "'2" || suffix === "2'") amount = 2;
  else if (suffix === "'") amount = 3; // 3 === -1 mod 4

  return { face, amount, originalStr: trimmed, mergeable: Boolean(strict) };
}

function formatMoveToken(face: string, amount: number): string | null {
  const norm = ((amount % 4) + 4) % 4;
  if (norm === 0) return null;
  if (norm === 1) return face;
  if (norm === 2) return `${face}2`;
  if (norm === 3) return `${face}'`;
  return null;
}

/**
 * Simplifies a sequence of move strings, merging consecutive or commuting moves on the same face.
 *
 * Examples:
 * - ['U2', "U'"] -> ['U']
 * - ["U'", "U'"] -> ['U2']
 * - ['U', "U'"] -> []
 * - ['U', 'D', "U'"] -> ['D']
 * - ['R2', 'R2'] -> []
 */
export function simplifyMoveSequence(moves: string[]): string[] {
  if (!moves || moves.length === 0) return [];

  const stack: MoveToken[] = [];

  for (const moveStr of moves) {
    const token = parseMoveToken(moveStr);
    if (!token) continue;

    let merged = false;

    // Case 1: Merge directly with top of stack (any same-face pair, including
    // rotations/wides — `y y'` -> [], `y y` -> `y2`).
    if (stack.length > 0 && stack[stack.length - 1].face === token.face) {
      const top = stack.pop()!;
      const newAmount = (top.amount + token.amount) % 4;
      if (newAmount !== 0) {
        stack.push({
          face: token.face,
          amount: newAmount,
          originalStr: formatMoveToken(token.face, newAmount)!,
          mergeable: token.mergeable,
        });
      }
      merged = true;
      continue;
    }

    // Case 2: Commute across opposite face (e.g. U then D then U') — only for
    // plain outer turns; a rotation/wide/slice in any of the three slots blocks
    // it and acts as an opaque barrier.
    if (
      stack.length >= 2 &&
      token.mergeable &&
      stack[stack.length - 1].mergeable &&
      stack[stack.length - 2].mergeable &&
      OPPOSITE_FACES[stack[stack.length - 1].face] === token.face &&
      stack[stack.length - 2].face === token.face
    ) {
      const middle = stack.pop()!; // The commuting opposite face (e.g. D)
      const target = stack.pop()!; // The matching face (e.g. U)

      const newAmount = (target.amount + token.amount) % 4;
      if (newAmount !== 0) {
        stack.push({
          face: token.face,
          amount: newAmount,
          originalStr: formatMoveToken(token.face, newAmount)!,
          mergeable: true,
        });
      }
      // Put middle back
      stack.push(middle);
      merged = true;
      continue;
    }

    if (!merged) {
      stack.push(token);
    }
  }

  // Format tokens back to move strings
  return stack
    .map((t) => formatMoveToken(t.face, t.amount))
    .filter((m): m is string => m !== null);
}

/**
 * Simplifies a space-separated algorithm string.
 */
export function simplifyAlgString(alg: string): string {
  if (!alg) return '';
  const tokens = alg.trim().split(/\s+/);
  return simplifyMoveSequence(tokens).join(' ');
}

/**
 * Inverts a single move token. Pure string algebra in the raw move-letter frame —
 * `R -> R'`, `R' -> R`, `R2 -> R2`, `U -> U'`. Rotations/wides invert too (`y -> y'`).
 * Never relabels faces (the caller is on the safe side of the solver boundary).
 */
export function invertMove(move: string): string {
  const token = parseMoveToken(move);
  if (!token) return move;
  const inverted = (4 - (token.amount % 4)) % 4;
  return formatMoveToken(token.face, inverted) ?? move;
}

/**
 * The face letter of a move (`R2` -> `R`, `y'` -> `y`), or null if unparseable.
 */
export function moveFace(move: string): string | null {
  return parseMoveToken(move)?.face ?? null;
}

/**
 * True when two moves act on the same face (ignoring amount/direction).
 */
export function sameFace(a: string, b: string): boolean {
  const fa = moveFace(a);
  return fa !== null && fa === moveFace(b);
}

/**
 * True only for plain outer face turns (`U D F B L R` with optional `'`/`2`) — the
 * moves that `simplifyMoveSequence` can safely merge and commute. Rotations, wide
 * moves, slices and anything unrecognised return false.
 */
export function isSimpleFaceMove(move: string): boolean {
  return Boolean(parseMoveToken(move)?.mergeable);
}

/**
 * The face that commutes with `face` under `simplifyMoveSequence`'s merge rule
 * (`U`<->`D`, `L`<->`R`, `F`<->`B`), or `undefined` for anything else.
 */
export function oppositeFace(face: string): string | undefined {
  return OPPOSITE_FACES[face];
}
