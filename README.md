# Cube Timer & Trainer

A mobile-first, installable PWA for speedcubing that pairs with a Bluetooth smart cube,
reads its live physical state, and uses that to run a real timer and a CFOP teaching
walkthrough — not just a stopwatch with a scramble generator bolted on.

Built against the design spec at [`resources/cube-trainer-spec.md`](resources/cube-trainer-spec.md).
For engineering notes, architectural gotchas, and where the code currently stands relative
to that spec, see [`CLAUDE.md`](CLAUDE.md).

## What it does

**Scramble.** Generates an official WCA scramble and walks you through it move by move. With
a smart cube connected, your physical turns are matched against the expected sequence and
advance it automatically — no button-tapping through your own scramble.

**Timed Solve.** A speedcubing timer.
- No cube connected: a plain two-phase timer (inspection, then solve).
- Cube connected: auto-starts the moment you make your first turn, auto-stops the instant
  the cube reports solved, and breaks the whole solve into live CFOP phase splits — cross,
  each F2L slot, OLL, PLL — with per-phase time and turns-per-second, computed straight from
  real move events.

**Guided Solve.** A step-by-step CFOP tutor. Given the cube's current state it computes the
next move for whichever phase you're in — a dedicated cross solver, then case-database
lookups for F2L/OLL/PLL (57 OLL cases, 21 PLL cases, 164 F2L entries), with a full-solve
fallback guaranteeing there's always a next move to show. Two independent settings, neither
gating the other:
- **Technique tier** — 2-look, Full PLL, or Full CFOP, matching how CFOP is actually taught.
- **Notation mode** — Simplified (single-layer turns only) or Standard (wide moves and
  rotations included), so someone new to reading move notation isn't stuck on that while
  still learning the technique.

**History.** Every timed solve is saved locally (profiles, no account/cloud) with its full
phase breakdown, and session stats (Ao5, best, mean) are computed from it.

## Status

The scramble/timer/history loop and the guided-solve hint engine (solver, case matching,
dataset, tier/notation settings) are built and working. The one significant gap: **Guided
Solve doesn't yet react to physical cube turns** — it advances by button/timer only, so
turning a connected cube while in that mode doesn't do anything. Everything else — connect
→ read state → auto-route to Scramble or Timed, live phase splits, scramble move-matching —
is wired up. See `CLAUDE.md`'s "open items" section for the full list of what's built,
what's partial, and what's still open.

## Stack

- **React + TypeScript + Vite**, installable PWA (`vite-plugin-pwa`)
- **[cubing.js](https://js.cubing.net/)** for everything cube-related: Bluetooth
  (`cubing/bluetooth`), cube state (`cubing/kpuzzle`), 3D visualization (`cubing/twisty`),
  WCA-legal scrambling (`cubing/scramble`), and solving (`cubing/search`)
- **Zustand** for app state
- **Dexie** (IndexedDB) for local persistence — no backend, no account system
- **Tailwind CSS**
- Solver-heavy work (case matching, full-solve fallback) runs in a **Web Worker**, never on
  the main thread

## Smart cube support

Anything `cubing/bluetooth` supports: GAN, QiYi AI, Giiker/Mijia, GoCube. Requires a
Web Bluetooth–capable browser (Chrome, Edge — not Safari or Firefox). No cube connection is
required for Scramble or the two-phase Timed Solve; it's what unlocks live phase tracking
and physical move-matching.

## Getting started

```bash
npm install
npm run dev        # start the Vite dev server
```

```bash
npm run build       # typecheck (tsc -b) + production build
npm test             # run the test suite (vitest)
npm run gen:algs   # regenerate the CFOP algorithm dataset from resources/cfop-algorithms-new.json
```

## Project structure

```
src/
  components/views/   Scramble / Timed Solve / Guided Solve / History screens
  components/         Shared UI (header, modals, 3D visualizer wrapper, etc.)
  hooks/               useSmartCube (Bluetooth), useTimer, useSolverWorker
  store/               Zustand stores (cube state, app/UI state)
  solver/              Cross BFS, OLL/PLL/F2L case matching, full-solve fallback,
                       Web Worker entry point
  utils/               Phase detection, KPattern helpers, telemetry math
  data/                Generated CFOP algorithm dataset (do not hand-edit — see gen:algs)
  db/                  Dexie schema + repository functions
  tests/               Vitest suites (solver correctness, phase detection, store logic)
resources/
  cube-trainer-spec.md      Design/architecture spec this app is built against
  cfop-algorithms-new.json  Hand-maintained algorithm source (see scripts/generateAlgorithmData.mjs)
  design-mockup.html        Visual design reference
```

## Contributing / working in this repo

Read `CLAUDE.md` first — it covers the cube-orientation gotchas that have already caused at
least one real, silent bug (see its "Cube-physics gotchas" section), plus the current list of
places where the implementation and the spec have drifted apart, flagged for discussion
rather than silently resolved either way.
