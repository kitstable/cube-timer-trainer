import type { CFOPPhase, F2LSlotId } from '../types/cube';

export const COLORS = {
  bg: '#101116',
  surface: '#1A1C23',
  surface2: '#22252E',
  border: '#2C2F3A',
  text: '#F3F1EA',
  textMuted: '#8A8E9C',

  white: '#F3F1EA',
  yellow: '#FFD500',
  gold: '#E8A200',
  red: '#C8102E',
  orange: '#FF6D1F',
  blue: '#0057B8',
  green: '#009A44',
} as const;

export const PHASE_COLORS: Record<string, string> = {
  inspection: COLORS.textMuted,
  solve: COLORS.white,
  cross: COLORS.white,
  'f2l-1': COLORS.green,
  'f2l-2': COLORS.red,
  'f2l-3': COLORS.blue,
  'f2l-4': COLORS.orange,
  oll: COLORS.yellow,
  pll: COLORS.gold,
  auf: COLORS.gold,
  solved: COLORS.green,
};

export const PHASE_DISPLAY_NAMES: Record<CFOPPhase, string> = {
  inspection: 'Inspection',
  cross: 'Cross',
  'f2l-1': 'F2L 1',
  'f2l-2': 'F2L 2',
  'f2l-3': 'F2L 3',
  'f2l-4': 'F2L 4',
  oll: 'OLL',
  pll: 'PLL',
  auf: 'AUF',
  solved: 'Solved',
};

export const ALL_F2L_SLOTS: F2LSlotId[] = ['FR', 'FL', 'BR', 'BL'];

/**
 * Guided scramble: how long to wait for a second quarter-turn before surfacing a
 * same-face "partial" cue. Absorbs fluid double turns (an `R2` arrives as `R` + `R`)
 * silently; a genuine mid-face stop still shows the cue after this delay.
 */
export const SCRAMBLE_PARTIAL_GRACE_MS = 800;

export const CFOP_PHASE_ORDER: CFOPPhase[] = [
  'cross',
  'f2l-1',
  'f2l-2',
  'f2l-3',
  'f2l-4',
  'oll',
  'pll',
  'auf',
  'solved',
];

export const MOVE_DESCRIPTIONS: Record<string, string> = {
  R: 'Right face 90° clockwise',
  "R'": 'Right face 90° counter-clockwise',
  R2: 'Right face 180°',
  L: 'Left face 90° clockwise',
  "L'": 'Left face 90° counter-clockwise',
  L2: 'Left face 180°',
  U: 'Top face 90° clockwise',
  "U'": 'Top face 90° counter-clockwise',
  U2: 'Top face 180°',
  D: 'Bottom face 90° clockwise',
  "D'": 'Bottom face 90° counter-clockwise',
  D2: 'Bottom face 180°',
  F: 'Front face 90° clockwise',
  "F'": 'Front face 90° counter-clockwise',
  F2: 'Front face 180°',
  B: 'Back face 90° clockwise',
  "B'": 'Back face 90° counter-clockwise',
  B2: 'Back face 180°',
};

export function getMoveDescription(move?: string): string {
  if (!move) return '';
  return MOVE_DESCRIPTIONS[move] || `Turn face ${move}`;
}

