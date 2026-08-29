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
}

function parseMoveToken(moveStr: string): MoveToken | null {
  const trimmed = moveStr.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^([UDFBLRudfblrMSE])('?2|2'?|')?$/);
  if (!match) {
    return { face: trimmed, amount: 1, originalStr: trimmed };
  }

  const face = match[1];
  const suffix = match[2] || '';

  let amount = 1;
  if (suffix === '2' || suffix === "'2" || suffix === "2'") {
    amount = 2;
  } else if (suffix === "'") {
    amount = 3; // 3 === -1 mod 4
  }

  return { face, amount, originalStr: trimmed };
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

    // Case 1: Merge directly with top of stack
    if (stack.length > 0 && stack[stack.length - 1].face === token.face) {
      const top = stack.pop()!;
      const newAmount = (top.amount + token.amount) % 4;
      if (newAmount !== 0) {
        stack.push({
          face: token.face,
          amount: newAmount,
          originalStr: formatMoveToken(token.face, newAmount)!,
        });
      }
      merged = true;
      continue;
    }

    // Case 2: Commute across opposite face (e.g. U then D then U')
    if (
      stack.length >= 2 &&
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
