import { describe, it, expect } from 'vitest';
import {
  classifyScrambleMove,
  feedbackForClassification,
  type ScrambleClassification,
} from '../utils/scrambleTracker';
import { moveFace, oppositeFace, simplifyMoveSequence } from '../utils/moveSimplifier';

/** Thread a run of physical turns through the tracker. */
function run(scramble: string[], moves: string[]): ScrambleClassification {
  let done: string[] = [];
  let correctionActive = false;
  let last: ScrambleClassification = {
    kind: 'progress',
    nextRemaining: scramble,
    nextDone: [],
    corrections: [],
    correctionActive: false,
  };
  for (const m of moves) {
    last = classifyScrambleMove(scramble, done, m, correctionActive);
    done = last.nextDone;
    correctionActive = last.correctionActive;
  }
  return last;
}

const S = ["L'", 'D', 'F2'];

describe('classifyScrambleMove', () => {
  it('advances on the expected move', () => {
    const r = run(S, ["L'"]);
    expect(r.kind).toBe('progress');
    expect(r.nextRemaining).toEqual(['D', 'F2']);
    expect(r.corrections).toEqual([]);
  });

  it('treats a wrong-direction turn on the right face as a partial, not an error', () => {
    const r = run(S, ['L']);
    expect(r.kind).toBe('partial');
    expect(r.nextRemaining).toEqual(['L2', 'D', 'F2']);
    expect(r.corrections).toEqual(['L2']);
    expect(r.correctionActive).toBe(false);
  });

  it('half-completes an L2 with a single L, then finishes on the next L', () => {
    const scramble = ['L2', 'D', 'F2'];
    const half = run(scramble, ["L'"]);
    expect(half.kind).toBe('partial');
    expect(half.nextRemaining).toEqual(["L'", 'D', 'F2']);

    const done = run(scramble, ["L'", "L'"]);
    expect(done.kind).toBe('progress');
    expect(done.nextRemaining).toEqual(['D', 'F2']);
  });

  it('prepends a correction for a wrong face (non-adjacent)', () => {
    const r = run(S, ['R']);
    expect(r.kind).toBe('error');
    expect(r.nextRemaining).toEqual(["R'", "L'", 'D', 'F2']);
    expect(r.corrections).toEqual(["R'"]);
    expect(r.correctionActive).toBe(true);
  });

  it('prepends a correction for a wrong face that is adjacent (does not commute away)', () => {
    const r = run(S, ['D']); // expected L', D and L' do not commute
    expect(r.kind).toBe('error');
    expect(r.corrections).toEqual(["D'"]);
  });

  it('accepts adjacent commuting moves played out of order', () => {
    const r = run(['U', 'D', 'F2'], ['D']);
    expect(r.kind).toBe('progress');
    expect(r.nextRemaining).toEqual(['U', 'F2']);
    expect(r.corrections).toEqual([]);
  });

  it('flags an out-of-order move when a non-commuting move sits between', () => {
    const r = run(['U', 'F2', 'D'], ['D']);
    expect(r.kind).toBe('error');
  });

  it('accumulates corrections for two wrong moves in a row', () => {
    const r = run(S, ['R', 'F']);
    expect(r.kind).toBe('error');
    expect(r.corrections).toEqual(["F'", "R'"]);
    expect(r.nextRemaining).toEqual(["F'", "R'", "L'", 'D', 'F2']);
  });

  it('clears the correction when a wrong move is undone', () => {
    const r = run(S, ['R', "R'"]);
    expect(r.kind).toBe('progress');
    expect(r.correctionActive).toBe(false);
    expect(r.nextRemaining).toEqual(S);
  });

  it('keeps a repeated wrong move classified as an error, not a partial', () => {
    const r = run(S, ['R', 'R']);
    expect(r.kind).toBe('error');
    expect(r.corrections).toEqual(['R2']);
    expect(r.nextRemaining).toEqual(['R2', "L'", 'D', 'F2']);
  });

  it('ignores rotations and wide moves without touching the tracker', () => {
    for (const m of ['y', "Rw'", 'M']) {
      const r = run(S, [m]);
      expect(r.kind).toBe('ignored');
      expect(r.nextRemaining).toEqual(S);
      expect(r.nextDone).toEqual([]);
    }
  });

  it('reports completion when the last move lands the scramble', () => {
    const r = run(S, ["L'", 'D', 'F2']);
    expect(r.kind).toBe('complete');
    expect(r.nextRemaining).toEqual([]);
  });

  it('recovers to completion after a mistake and its correction', () => {
    const r = run(S, ['R', "R'", "L'", 'D', 'F2']);
    expect(r.kind).toBe('complete');
    expect(r.nextRemaining).toEqual([]);
  });

  it('does not let a repeated face+direction elsewhere in the sequence mask a half-turned double', () => {
    // `L` appears twice — once as its own move, once as half of the later `L2`. A whole-array
    // literal-token match can spuriously accept the L2's first quarter-turn as `progress`
    // (matching against the *first* L) instead of `partial`.
    const scramble = ['L', 'U', 'L2', 'D', 'F2', 'R2'];
    const r = run(scramble, ['L', 'U', 'L']);
    expect(r.kind).toBe('partial');
    expect(r.nextRemaining).toEqual(['L', 'D', 'F2', 'R2']);
  });

  it('classifies a correct move that commutes with an owed correction as still needing its residual turn, never as a fresh error', () => {
    // Scramble is a single `R2`. The user turns `L` (wrong), then does the objectively correct
    // next half-turn `R` — which commutes with the owed `L'` correction. A naive "did the
    // correction's suffix-mismatch length grow" heuristic misclassifies this `R` as `error`.
    const scramble = ['R2'];
    const afterWrong = run(scramble, ['L']);
    expect(afterWrong.kind).toBe('error');
    expect(afterWrong.nextRemaining).toEqual(["L'", 'R2']);

    const afterCorrectHalf = run(scramble, ['L', 'R']);
    expect(afterCorrectHalf.kind).toBe('partial');
    expect(afterCorrectHalf.nextRemaining).toEqual(['R', "L'"]);
    expect(afterCorrectHalf.correctionActive).toBe(true);

    const recovered = run(scramble, ['L', 'R', 'R', "L'"]);
    expect(recovered.kind).toBe('complete');
    expect(recovered.nextRemaining).toEqual([]);
  });
});

describe('classifyScrambleMove — fuzz', () => {
  // Deterministic PRNG (mulberry32), same pattern used in guidedConvergence.test.ts.
  function mulberry32(seed: number) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FACES = ['U', 'D', 'L', 'R', 'F', 'B'];
  const SUFFIXES = ['', "'", '2'];

  // Real WCA scrambles and CFOP algorithms are always already canonical (no adjacent-same-face
  // repeats, and no opposite-face-sandwiched triple like `R' L' R` that `simplifyMoveSequence`
  // would itself fold further) — `classifyScrambleMove` assumes its `scrambleMoves` input has
  // this property, exactly as the old whole-array `isSubsequence` check implicitly did too.
  // Verify canonicity directly (round-trip through the simplifier) rather than trying to
  // constructively avoid every pattern that could fold, since a fold can cascade through a
  // stack of prior merges in ways that aren't visible from a fixed-size local window.
  function randomCanonicalScramble(rand: () => number, len: number): string[] {
    for (let attempt = 0; attempt < 50; attempt++) {
      const moves: string[] = [];
      let last = '';
      for (let i = 0; i < len; i++) {
        let f = FACES[Math.floor(rand() * FACES.length)];
        while (f === last) f = FACES[Math.floor(rand() * FACES.length)];
        last = f;
        moves.push(f + SUFFIXES[Math.floor(rand() * SUFFIXES.length)]);
      }
      if (simplifyMoveSequence(moves).join(',') === moves.join(',')) return moves;
    }
    throw new Error('failed to generate a canonical random scramble');
  }

  const TRIALS = 3000;
  const rand = mulberry32(0xc0ffee);

  it('never classifies verbatim execution of the scramble as an error', () => {
    for (let t = 0; t < TRIALS; t++) {
      const scramble = randomCanonicalScramble(rand, 2 + Math.floor(rand() * 8));
      let done: string[] = [];
      let correctionActive = false;
      for (let i = 0; i < scramble.length; i++) {
        const cls = classifyScrambleMove(scramble, done, scramble[i], correctionActive);
        expect(cls.kind === 'error').toBe(false);
        done = cls.nextDone;
        correctionActive = cls.correctionActive;
      }
    }
  });

  it('never classifies a genuinely wrong-face turn as progress/complete', () => {
    for (let t = 0; t < TRIALS; t++) {
      const scramble = randomCanonicalScramble(rand, 3 + Math.floor(rand() * 6));
      const stopAt = 1 + Math.floor(rand() * (scramble.length - 1));
      const done = scramble.slice(0, stopAt);
      const remaining = run(scramble, done).nextRemaining;
      if (remaining.length === 0) continue;
      const nextFace = moveFace(remaining[0]);
      let wrongFace = FACES[Math.floor(rand() * FACES.length)];
      // Also avoid the one legitimate reorder tolerance (the commuting second token).
      const secondFace = remaining.length > 1 ? moveFace(remaining[1]) : null;
      const allowed = new Set([nextFace, secondFace && oppositeFace(nextFace!) === secondFace ? secondFace : null]);
      let guard = 0;
      while (allowed.has(wrongFace) && guard++ < 20) {
        wrongFace = FACES[Math.floor(rand() * FACES.length)];
      }
      if (allowed.has(wrongFace)) continue; // couldn't find a truly wrong face this trial
      const cls = classifyScrambleMove(scramble, done, wrongFace, false);
      expect(['error']).toContain(cls.kind);
    }
  });

  it('never classifies the first quarter-turn of a double as progress/complete', () => {
    for (let t = 0; t < TRIALS; t++) {
      const scramble = randomCanonicalScramble(rand, 2 + Math.floor(rand() * 6));
      // Force the first move to be a double so we control the double's position exactly.
      const doubled = [scramble[0].replace(/['2]*$/, '2'), ...scramble.slice(1)];
      const half = doubled[0][0];
      const cls = classifyScrambleMove(doubled, [], half, false);
      expect(cls.kind).toBe('partial');
    }
  });

  it('maintains correctionActive iff a non-empty correction is owed on error', () => {
    for (let t = 0; t < TRIALS; t++) {
      const scramble = randomCanonicalScramble(rand, 2 + Math.floor(rand() * 6));
      const move = FACES[Math.floor(rand() * FACES.length)] + SUFFIXES[Math.floor(rand() * SUFFIXES.length)];
      const cls = classifyScrambleMove(scramble, [], move, false);
      if (cls.kind === 'error') {
        expect(cls.correctionActive).toBe(true);
        expect(cls.corrections.length).toBeGreaterThan(0);
      }
      expect(cls.nextRemaining.length === 0).toBe(cls.kind === 'complete');
    }
  });
});

describe('feedbackForClassification', () => {
  it('no cue on a clean progressing / completing turn', () => {
    expect(feedbackForClassification(run(S, ["L'"]))).toBeNull();
    expect(feedbackForClassification(run(S, ["L'", 'D', 'F2']))).toBeNull();
  });

  it('amber cue for a same-face half turn', () => {
    expect(feedbackForClassification(run(['L2', 'D', 'F2'], ["L'"]))).toEqual({
      kind: 'partial',
      corrections: ["L'"],
    });
  });

  it('red cue on a wrong turn', () => {
    expect(feedbackForClassification(run(S, ['R']))).toEqual({ kind: 'error', corrections: ["R'"] });
  });

  it('keeps the red cue up (with the remaining owed moves) while a mistake is only half-fixed', () => {
    // Two wrong turns, then undo one: the classification is `progress` (burden shrank) but a
    // correction is still owed — the cue must stay, not silently vanish.
    const halfFixed = run(S, ['R', 'F', "F'"]);
    expect(halfFixed.kind).toBe('progress');
    expect(feedbackForClassification(halfFixed)).toEqual({ kind: 'error', corrections: ["R'"] });

    const fullyFixed = run(S, ['R', 'F', "F'", "R'"]);
    expect(feedbackForClassification(fullyFixed)).toBeNull();
  });
});
