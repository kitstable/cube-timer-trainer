import React from 'react';
import type { ScrambleFeedback } from '../../types/cube';

/**
 * The one shared visual language for the connected-cube move guide's wrong-turn / half-turn
 * cues. Scramble, Guided Solve and Training all walk the user through a move sequence with a
 * smart cube connected, and all three must react to mistakes identically:
 *
 *   error   → flash the panel RED (ring + glow) · show the owed undo move(s) RED in the ribbon
 *   partial → flash the panel AMBER (ring + glow) · show the move to finish AMBER in the ribbon
 *
 * The "wait a small moment before showing the half-turn cue" is handled upstream by
 * `scramblePartialGate` (the grace window), not here — by the time a `partial` reaches the
 * store / view state it should be shown immediately.
 *
 * These are plain class helpers rather than a wrapper component so each view keeps its own
 * layout; the point is that the *colours, wording and which token* are defined once.
 */

export type TrackFeedbackKind = ScrambleFeedback['kind'] | null;

/** Ring + glow that flashes the 3D-view panel on a wrong or half turn. */
export function trackFeedbackPanelClass(kind: TrackFeedbackKind): string {
  if (kind === 'error') {
    return 'ring-2 ring-[var(--red)] shadow-[0_0_0_4px_rgba(200,16,46,0.28)]';
  }
  if (kind === 'partial') {
    return 'ring-2 ring-[var(--orange)] shadow-[0_0_0_4px_rgba(255,109,31,0.24)]';
  }
  return '';
}

/** The large "next move" badge colour when a cue is active (falls back to the neutral style). */
export function trackFeedbackBadgeClass(kind: TrackFeedbackKind): string {
  if (kind === 'error') return 'bg-[var(--red)]/15 text-[var(--red)] border-[var(--red)]/40';
  if (kind === 'partial') return 'bg-[var(--orange)]/15 text-[var(--orange)] border-[var(--orange)]/40';
  return 'bg-[var(--surface-2)] text-[var(--white)] border-[var(--border)]';
}

/** A correction / finish-the-turn chip in the move ribbon. Empty string when no cue. */
export function trackFeedbackChipClass(kind: TrackFeedbackKind): string {
  if (kind === 'error') return 'bg-[var(--red)]/15 text-[var(--red)] ring-1 ring-[var(--red)]/40 font-bold';
  if (kind === 'partial') return 'bg-[var(--orange)]/15 text-[var(--orange)] ring-1 ring-[var(--orange)]/40 font-bold';
  return '';
}

/** The one-line explanation shown next to the guide. Identical wording in every mode. */
export const TrackFeedbackMessage: React.FC<{ feedback: ScrambleFeedback }> = ({ feedback }) => {
  const moves = feedback.corrections.join(' ');
  if (feedback.kind === 'error') {
    return (
      <div className="text-xs font-semibold text-[var(--red)]">
        Wrong turn — do {moves} to get back on track
      </div>
    );
  }
  return (
    <div className="text-xs font-semibold text-[var(--orange)]">
      Half turn — keep turning this face to {moves}
    </div>
  );
};
