import type { KPattern } from 'cubing/kpuzzle';

export type CFOPPhase =
  | 'inspection'
  | 'cross'
  | 'f2l-1'
  | 'f2l-2'
  | 'f2l-3'
  | 'f2l-4'
  | 'oll'
  | 'pll'
  | 'auf'
  | 'solved';

export type F2LSlotId = 'FR' | 'FL' | 'BR' | 'BL';

export type AppMode = 'scramble' | 'timed' | 'guided' | 'training' | 'history';

export type TechniqueTier = '2look' | 'fullPLL' | 'fullCFOP';
export type NotationMode = 'simplified' | 'standard';



export interface TimestampedMove {
  move: string;
  timestamp: number;
  deltaMs: number;
  phase: CFOPPhase;
}

export interface PhaseStatus {
  isCrossSolved: boolean;
  solvedSlots: F2LSlotId[];
  isF2LSolved: boolean;
  isOLLSolved: boolean;
  isPLLSolved: boolean;
  isFullySolved: boolean;
  currentPhase: CFOPPhase;
}

export interface SmartCubeState {
  isConnected: boolean;
  isConnecting: boolean;
  deviceName: string | null;
  batteryLevel: number | null;
  error: string | null;
  /** false = this cube/protocol can't report its physical state; the user must calibrate manually. */
  stateReadSupported: boolean;
}

/** Transient cue shown when a guided-scramble turn is wrong or half-done. */
export interface ScrambleFeedback {
  kind: 'error' | 'partial';
  /** Leading remaining-ribbon tokens to highlight (red for error, amber for partial). */
  corrections: string[];
}

export interface MoveHint {
  phase: CFOPPhase;
  phaseName: string;
  moves: string[];
  currentIndex: number;
  caseName?: string;
  rawAlg?: string;
}

export interface TwistPatternState {
  pattern: KPattern | null;
  algString: string;
}
