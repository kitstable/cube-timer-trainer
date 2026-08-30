import { describe, it, expect } from 'vitest';
import {
  invertMove,
  isSimpleFaceMove,
  moveFace,
  sameFace,
  simplifyMoveSequence,
} from '../utils/moveSimplifier';

describe('invertMove', () => {
  it('inverts single face turns', () => {
    expect(invertMove('R')).toBe("R'");
    expect(invertMove("R'")).toBe('R');
    expect(invertMove('R2')).toBe('R2');
    expect(invertMove('U')).toBe("U'");
    expect(invertMove('F2')).toBe('F2');
  });

  it('inverts rotations and wide moves too', () => {
    expect(invertMove('y')).toBe("y'");
    expect(invertMove("Rw'")).toBe('Rw');
  });
});

describe('isSimpleFaceMove', () => {
  it('accepts plain outer turns only', () => {
    for (const m of ['R', "R'", 'R2', 'U', 'D2', "L'"]) {
      expect(isSimpleFaceMove(m)).toBe(true);
    }
  });

  it('rejects rotations, wides, slices and junk', () => {
    for (const m of ['Rw', 'M', 'y', 'x2', 'E', 'S', '']) {
      expect(isSimpleFaceMove(m)).toBe(false);
    }
  });
});

describe('moveFace / sameFace', () => {
  it('extracts the face letter', () => {
    expect(moveFace('R2')).toBe('R');
    expect(moveFace("y'")).toBe('y');
    expect(sameFace('L', "L'")).toBe(true);
    expect(sameFace('L', 'R')).toBe(false);
  });
});

describe('simplifyMoveSequence — behaviours the scramble tracker relies on', () => {
  it('merges and cancels on the same face', () => {
    expect(simplifyMoveSequence(['U2', "U'"])).toEqual(['U']);
    expect(simplifyMoveSequence(['U', "U'"])).toEqual([]);
    expect(simplifyMoveSequence(["L'", "L'"])).toEqual(['L2']);
  });

  it('commutes across opposite faces', () => {
    expect(simplifyMoveSequence(['U', 'D', "U'"])).toEqual(['D']);
    expect(simplifyMoveSequence(['R', 'L', "R'"])).toEqual(['L']);
    expect(simplifyMoveSequence(['R', 'L', "R'", "L'"])).toEqual([]);
  });
});
