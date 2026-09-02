/**
 * Relabel a whole alg string from the raw / library-default (white-up) move frame into the
 * post-z2 (yellow-up) frame — i.e. compute `z2 · X · z2` token by token, order preserved.
 *
 * **Render-only.** This is used purely to feed `<twisty-player>` a yellow-face-up picture in
 * the solve views (Timed / connected Guided / connected Training) when the move stream it has
 * to display (`visualAlg`, `moveHistory`, a WCA scramble) is authored in the raw frame.
 * `<twisty-player>` has no orientation prop — you reorient with `experimentalSetupAlg="z2"`
 * and then every move in `alg` must be in that same frame, or the animation turns the wrong
 * faces. Never feed the output of this back into the store / solver / trackers / persistence:
 * those all deliberately stay in the raw frame.
 *
 * Identity that makes the wiring correct: `A · z2 == z2 · relabelForDisplay(A)`, so
 * `solved · z2 · relabelForDisplay(A)` is exactly `solved · A` viewed after a `z2` turn.
 *
 * z2 = 180° about the F–B axis. It reverses the U–D and L–R axes and leaves F–B alone:
 *  - `U↔D`, `L↔R` (and their wides) — swap the letter, keep the modifier.
 *  - `F`, `B`, `S`, `z` (and F/B wides) — unchanged.
 *  - `M`, `E`, `x`, `y` — same letter, reversed direction (`X'`↔`X`, `X2`→`X2`).
 */

type Rule = { kind: 'swap'; to: string } | { kind: 'flip' } | { kind: 'identity' };

const RULES: Record<string, Rule> = {
  U: { kind: 'swap', to: 'D' },
  D: { kind: 'swap', to: 'U' },
  L: { kind: 'swap', to: 'R' },
  R: { kind: 'swap', to: 'L' },
  F: { kind: 'identity' },
  B: { kind: 'identity' },
  // lowercase wides
  u: { kind: 'swap', to: 'd' },
  d: { kind: 'swap', to: 'u' },
  l: { kind: 'swap', to: 'r' },
  r: { kind: 'swap', to: 'l' },
  f: { kind: 'identity' },
  b: { kind: 'identity' },
  // explicit wides
  Uw: { kind: 'swap', to: 'Dw' },
  Dw: { kind: 'swap', to: 'Uw' },
  Lw: { kind: 'swap', to: 'Rw' },
  Rw: { kind: 'swap', to: 'Lw' },
  Fw: { kind: 'identity' },
  Bw: { kind: 'identity' },
  // slices
  M: { kind: 'flip' },
  E: { kind: 'flip' },
  S: { kind: 'identity' },
  // whole-cube rotations
  x: { kind: 'flip' },
  y: { kind: 'flip' },
  z: { kind: 'identity' },
};

const TOKEN = /^([A-Za-z]+)(2'|'2|2|')?$/;

function relabelToken(tok: string): string {
  const match = TOKEN.exec(tok);
  if (!match) return tok;
  const base = match[1];
  const rule = RULES[base];
  if (!rule) return tok;

  let mod = match[2] ?? '';
  if (mod === "2'" || mod === "'2") mod = '2';

  if (rule.kind === 'identity') return base + mod;
  if (rule.kind === 'swap') return rule.to + mod;
  // flip: reverse direction, a double stays a double
  if (mod === '2') return base + '2';
  return base + (mod === "'" ? '' : "'");
}

export function relabelForDisplay(alg: string): string {
  const trimmed = alg.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/).map(relabelToken).join(' ');
}
