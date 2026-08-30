import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { CFOPPhase, TimestampedMove } from '../../types/cube';
import { PHASE_COLORS, PHASE_DISPLAY_NAMES } from '../../utils/constants';
import { phaseRecognitionMs } from '../../utils/telemetryCalculator';

/** Phases we surface as live splits, in order (AUF folds into PLL). */
const LIVE_PHASES: CFOPPhase[] = ['cross', 'f2l-1', 'f2l-2', 'f2l-3', 'f2l-4', 'oll', 'pll'];

const RECOGNITION_MIN_MS = 150;
const COMPLETE_FLASH_MS = 900;

const foldPhase = (p: CFOPPhase): CFOPPhase => (p === 'auf' ? 'pll' : p);

interface LivePhaseSplitsProps {
  moves: TimestampedMove[];
  currentPhase: CFOPPhase;
  /** `Date.now()` of the most recent physical move — drives the live tick of the active phase. */
  lastMoveTs: number;
  running: boolean;
}

/**
 * Real-time CFOP splits during a connected timed solve. Each phase shows as upcoming,
 * running, or done — a completed phase locks in its split time, gets a check, and flashes
 * its phase colour for a beat so finishing a step is something you actually *see*.
 */
export const LivePhaseSplits: React.FC<LivePhaseSplitsProps> = ({
  moves,
  currentPhase,
  lastMoveTs,
  running,
}) => {
  // Independent tick so the active phase's time keeps moving between physical turns.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running]);

  const rows = useMemo(() => {
    const byPhase = new Map<CFOPPhase, TimestampedMove[]>();
    for (const m of moves) {
      const p = foldPhase(m.phase);
      if (!byPhase.has(p)) byPhase.set(p, []);
      byPhase.get(p)!.push(m);
    }

    const current = foldPhase(currentPhase);
    const currentIdx = current === 'solved' ? LIVE_PHASES.length : LIVE_PHASES.indexOf(current);
    let firstScored = true;

    return LIVE_PHASES.map((phase, idx) => {
      const phaseMoves = byPhase.get(phase) ?? [];
      const durationMs = phaseMoves.reduce((acc, m) => acc + m.deltaMs, 0);
      const recognitionMs = phaseRecognitionMs(phaseMoves, firstScored);
      if (phaseMoves.length > 0) firstScored = false;

      const state: 'done' | 'active' | 'upcoming' =
        currentIdx < 0
          ? phaseMoves.length > 0
            ? 'done'
            : 'upcoming'
          : idx < currentIdx
          ? 'done'
          : idx === currentIdx
          ? 'active'
          : 'upcoming';

      const liveMs =
        state === 'active' && running && lastMoveTs > 0
          ? durationMs + Math.max(0, now - lastMoveTs)
          : durationMs;

      return { phase, state, ms: liveMs, recognitionMs, hasMoves: phaseMoves.length > 0 };
    });
  }, [moves, currentPhase, lastMoveTs, now, running]);

  // Flash a phase the moment it flips to done. Keyed by an expiry timestamp so the
  // 100ms tick (or the next move) clears it — no per-render timeout juggling.
  const prevDone = useRef<Set<CFOPPhase>>(new Set());
  const flashUntil = useRef<Map<CFOPPhase, number>>(new Map());
  useEffect(() => {
    const done = new Set(rows.filter((r) => r.state === 'done').map((r) => r.phase));
    for (const p of done) {
      if (!prevDone.current.has(p)) flashUntil.current.set(p, Date.now() + COMPLETE_FLASH_MS);
    }
    prevDone.current = done;
  }, [rows]);

  return (
    <div>
      {rows.map(({ phase, state, ms, recognitionMs, hasMoves }) => {
        const color = PHASE_COLORS[phase] || 'var(--text-muted)';
        const isFlash = (flashUntil.current.get(phase) ?? 0) > now;
        return (
          <div
            key={phase}
            className="px-3 py-2 border-b border-[var(--border)] last:border-b-0 transition-colors duration-300"
            style={isFlash ? { backgroundColor: `color-mix(in srgb, ${color} 22%, transparent)` } : undefined}
          >
            <div className="flex items-center justify-between font-mono text-[13px]">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-2 h-2 rounded-[2px] shrink-0 transition-opacity ${
                    state === 'upcoming' ? 'opacity-30' : ''
                  } ${state === 'active' ? 'animate-pulse' : ''}`}
                  style={{ backgroundColor: color }}
                />
                <span
                  className={`font-sans truncate ${
                    state === 'upcoming' ? 'text-[var(--text-muted)]/50' : 'text-[var(--text)]'
                  }`}
                >
                  {PHASE_DISPLAY_NAMES[phase]}
                </span>
                {state === 'done' && (
                  <Check className="w-3.5 h-3.5 text-[var(--green)] shrink-0" strokeWidth={3} />
                )}
                {state === 'active' && (
                  <span className="text-[var(--green)] italic text-[11px]">running</span>
                )}
              </div>

              <span
                className={`font-tabular shrink-0 ${
                  state === 'active'
                    ? 'text-[var(--green)]'
                    : state === 'done'
                    ? 'text-[var(--text)]'
                    : 'text-[var(--text-muted)]/50'
                }`}
              >
                {state === 'upcoming' && !hasMoves ? '—' : `${(ms / 1000).toFixed(2)}s`}
              </span>
            </div>

            {state !== 'upcoming' && recognitionMs >= RECOGNITION_MIN_MS && (
              <div className="pl-[18px] mt-0.5 text-[11px] text-[var(--orange)]/80 font-mono">
                +{(recognitionMs / 1000).toFixed(1)}s recognition
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
