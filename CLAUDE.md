# CLAUDE.md

Guidance for Claude Code (or any future contributor) working in this repo.

## What this is

A mobile-first PWA that pairs with a Bluetooth smart cube (GAN / QiYi / Giiker-Mijia /
GoCube), reads its live physical state, and uses that to drive two solving modes:

- **Scramble** — generates a WCA scramble, shows it as a walkthrough, and auto-advances as
  the physical cube matches each expected turn.
- **Timed Solve** — a speedcubing timer. Without a cube it's a plain two-phase
  (inspection/solve) stopwatch; with one connected it auto-starts/stops from real turns and
  breaks the solve into live CFOP phase splits (cross / F2L slots / OLL / PLL) with
  TPS/telemetry.
- **Guided Solve** — a CFOP teaching walkthrough (cross BFS solver + OLL/PLL/F2L
  case-database matching + a full-solve fallback so it never gets stuck), with independent
  technique-tier (2-look / Full PLL / Full CFOP) and notation-mode (Simplified / Standard)
  settings.

The full product/architecture spec this was built against lives at
`resources/cube-trainer-spec.md` — read that first for the *intended* design; this file is
about the state of the actual code and where it stands relative to that intent.

## Stack

React + TypeScript + Vite, `cubing.js` (`cubing/bluetooth`, `cubing/kpuzzle`, `cubing/twisty`,
`cubing/scramble`, `cubing/search`) for everything cube-related, Zustand for state, Dexie
for local IndexedDB persistence, Tailwind for styling. No backend, no accounts — everything
is local. Installable PWA via `vite-plugin-pwa`.

## Architecture, as built

- **`useCubeStore`** (`src/store/useCubeStore.ts`) — the live `KPattern`, move history,
  derived phase status, smart-cube connection state, and `visualAlg` (a running alg that
  reconstructs the live pattern from solved, used purely so the 3D visualizer can mirror
  real physical state — see "Recent work" below).
- **`useAppStore`** (`src/store/useAppStore.ts`) — active mode/tab, current scramble,
  technique tier, notation mode. The spec (§2) describes one combined store; this became two
  in practice, split roughly along "cube state" vs "app/UI state." Reasonable, not something
  that needs unwinding.
- **Phase detection** (`src/utils/phaseDetector.ts`, `src/solver/cfopInvariants.ts`) — pure,
  synchronous `KPattern -> PhaseStatus` functions, called on every move. No solver calls in
  this path, per the spec's snappy-UI rule.
- **Solver/hint core** (`src/solver/`) runs in a Web Worker (`solverWorker.ts`, bridged via
  `src/hooks/useSolverWorker.ts`) — cross BFS, OLL/PLL/F2L case matching against
  `src/data/cfop-algorithms.json`, and `fullSolveFallback.ts`'s guaranteed-progress backstop
  for Guided mode. `resources/cfop-algorithms-new.json` is the hand-maintained source;
  `scripts/generateAlgorithmData.mjs` derives the shipped dataset from it (see below).
- **Visualization** — `TwistyPlayerWrapper.tsx` wraps `cubing/twisty`'s `<twisty-player>`.
- **Bluetooth** — `src/hooks/useSmartCube.ts` is the only file that touches
  `cubing/bluetooth`. `connectSmartPuzzle()` does the GATT work; this hook syncs the result
  into `useCubeStore` and auto-routes the app (solved → Scramble, unsolved → Timed).

## Cube-physics gotchas learned in this repo

- **Orientation frame ("post-z2")**: the app's internal solved reference and several piece
  tables (`getPostZ2Pattern()` / `POST_Z2_EDGES` / `POST_Z2_CORNERS` in
  `src/utils/kpuzzleHelper.ts`, `SOLVED_EDGE_PIECES` / `SOLVED_CORNER_PIECES` in
  `src/solver/cfopInvariants.ts`) are expressed in a cube orientation rotated 180° (`z2`)
  from `cubing.js`'s own library default. `cubing.js`'s full-cube solver
  (`experimentalSolve3x3x3IgnoringCenters`) rejects a z2-rotated pattern outright
  ("non-oriented puzzles are not supported"), so anywhere that solver is called
  (`fullSolveFallback.ts`, and the newer `reconstructAlgForPattern`) has to apply `z2` before
  calling it and relabel the result back through a small `Z2_RELABEL` map (`U<->D`,
  `L<->R`, `F`/`B` fixed) afterward. **Get this backwards and you get a plausible-looking but
  wrong cube state, silently** — there's no type error to catch it. `cfopInvariants.ts` has a
  comment documenting a real past bug from exactly this (a swapped BL/BR edge table that
  corrupted back-slot F2L detection) — treat any new piece-index table or solver call
  touching this frame as something to double- and triple-check against a known scramble, not
  something to eyeball.
- **"Solved" is orientation-agnostic, deliberately**: `isPatternSolved()`
  (`kpuzzleHelper.ts`) checks the raw default orientation, the post-z2 orientation, *and* all
  24 whole-cube rotations — because a physical cube can be sitting in any rotation when read.
  Don't replace this with a single-orientation identity check.
- **Move-letter frame consistency**: physical move events from the smart cube, `moveHistory`,
  and `visualAlg` are all kept in the *same* raw/unrotated move-letter frame throughout — none
  of them get z2-relabeled. Only code that hands a pattern to `cubing.js`'s solver needs the
  z2 dance above; everything else (the 3D visualizer, phase math, move history) stays in one
  consistent frame. Don't be tempted to "fix" a visual mismatch by relabeling moves anywhere
  outside the solver boundary — the actual fix is almost always upstream, in what pattern/alg
  is being fed in.

## Recent work (this session)

1. **Smart-cube connect flow no longer guesses.** Previously, when a cube's protocol didn't
   support reading full state back (`getPattern()` missing/failing), the app silently
   guessed the mode from stale store state instead of saying so. Now `useSmartCube.ts`'s
   `syncPatternAndRoute` distinguishes "we really read your cube" from "we don't know"
   (`SmartCubeState.stateReadSupported`) and surfaces the unknown case in the connection
   modal instead of faking a routing decision.
2. **Timed Solve's 3D visualizer now mirrors the live cube.** It used to compose
   `setupAlg` from `useAppStore.currentScramble` (only ever set by generating a scramble via
   the Scramble page) + `alg` from `moveHistory`. Connecting a cube that was already
   mid-solve left `currentScramble` empty, so the visual started from an assumed-solved
   baseline while move *tracking* (which reads `pattern` directly) stayed correct — turns
   were recognized but the picture was wrong. Fixed via `useCubeStore.visualAlg`, an alg
   that's kept incrementally in sync with every real move and (re)seeded via
   `reconstructAlgForPattern` (solves the just-read pattern, inverts the result) whenever a
   fresh physical read succeeds. Routed through the existing solver worker, not called from
   the main thread.

Both are on `claude/smart-cube-connection-state-rs2s9a`.

3. **Guided scramble now tracks every physical turn, not just matching ones.** Previously
   `useSmartCube.ts` only advanced scramble progress on an exact `expected === moveStr`
   match; wrong turns were applied to `useCubeStore` but invisible to the guide, and
   `ScrambleView`'s 3D cube rendered from the progress *counter*, so one wrong turn desynced
   the picture with no recovery. Now every turn goes through `src/utils/scrambleTracker.ts`
   (pure move algebra — `remaining = done⁻¹ · scramble`, recomputed each move via
   `simplifyMoveSequence`): it advances on the expected move, absorbs same-face
   wrong-direction turns as "partials" (amber), and prepends correction move(s) for a wrong
   face (red glow on the cube card + ribbon). With a cube connected the 3D view mirrors
   `useCubeStore.visualAlg` (like Timed Solve) and the manual stepping controls are hidden.
   The no-cube path (keyboard / 2s auto-advance / `scrambleProgressIndex`) is unchanged.
   `scrambleTracker` is on the safe side of the solver boundary — pure move strings, no
   `KPattern`, so the z2 gotchas don't apply; completion is `nextRemaining.length === 0`,
   never a `pattern` check (in connected scramble mode `pattern` is the z2'd *target* with
   raw physical moves layered on top and is meaningless).

## Where the code stands relative to the spec — open items to discuss

The spec is the intended design; here's where the actual code hasn't caught up, or made a
different call than the spec described. Flagging these rather than silently deciding either
way:

1. **Guided Solve doesn't read the physical cube at all.** This is the biggest gap. Spec §5
   is explicit: a real move event should update ground truth and the hint should be
   disposable — recomputed fresh, never "was that a mistake" logic. Right now
   `GuidedSolveView.tsx` has zero references to the smart cube; `applyMove` still fires on
   every physical turn (so `useCubeStore.pattern` stays correct), but nothing in Guided mode
   listens for it — hint progression only advances via the Next-move button, a ribbon tap, or
   the 2-second auto-play timer. Turning the cube while in Guided mode does nothing visible.
   This is almost certainly the "going in circles" feeling from before this session's fixes.
   Worth a dedicated pass mirroring what `ScrambleView`/`useSmartCube.ts` already do for
   Scramble mode's move-matching.
2. **Guided-mode solves are never saved.** `saveSolve` is only ever called from
   `useTimer.ts` (Timed Solve). `Solve.mode` in `src/types/db.ts` includes `'guided'` as a
   valid value, but nothing produces one — Guided Solve has no History entries at all.
3. **LBL timing mode (spec §10b) isn't built.** No `method: 'F2L' | 'LBL'` field on `Solve`,
   no `lbl-corners`/`lbl-edges` phase names, no UI toggle. Whole section is unbuilt — worth
   confirming whether it's still wanted before investing in it.
4. **`Solve` records don't capture which tier/notation mode was used.** The spec (§6) lists
   `techniqueTier?`/`notationMode?` as optional fields on `Solve`; `src/types/db.ts`'s actual
   interface doesn't have them. History can't show what settings a past solve used.
5. **No onboarding question for new profiles.** Spec §10 describes a simple "have you
   learned F2L yet / comfortable with wide-move notation" question when starting fresh, so
   defaults reflect the user's actual level rather than an assumed floor. `ProfileModal.tsx`
   just takes a name — technique tier and notation mode are single global preferences
   (`useAppStore`), not asked for and not per-profile. Worth deciding whether that's fine as
   a global setting or should become part of profile creation.
6. **Some duplicated/vestigial pieces from incremental work:**
   - `src/components/ui/MoveRibbon.tsx` is unused — `GuidedSolveView` and `ScrambleView`
     each hand-roll their own near-identical move-chip ribbon inline instead.
   - `ALL_F2L_SLOTS` is defined twice (`src/utils/constants.ts` and
     `src/solver/cfopInvariants.ts`), as are the solved-piece tables
     (`kpuzzleHelper.ts` vs `cfopInvariants.ts`) — same underlying data, two places to keep
     in sync, which is exactly the kind of drift risk noted in the z2 gotcha above.
   - `useAppStore` has `guidanceTier`/`guidanceMethod` fields that duplicate `techniqueTier`
     (every setter writes all three); nothing reads the other two independently.
   - `findHint.ts` checks for a `'confident'` tier value that doesn't exist in the
     `TechniqueTier` type (`'2look' | 'fullPLL' | 'fullCFOP'`) — dead branch, likely a
     leftover from a renamed tier.

None of these are urgent fixes on their own — flagging them here so a decision gets made
deliberately (fix, descope, or explicitly accept) rather than each one being quietly
rediscovered later.

## Commands

```
npm install
npm run dev       # Vite dev server
npm run build     # tsc -b && vite build
npm test          # vitest run
npm run gen:algs  # regenerate src/data & public/data/cfop-algorithms.json from resources/cfop-algorithms-new.json
```

No lint script is currently configured.

## Testing notes

- `npm test` runs in plain Node (no jsdom) — tests exercise pure logic (solver, phase
  detection, store actions) directly, not React rendering.
- This repo has no Bluetooth hardware access in most dev/CI environments (including this
  session's sandbox) — anything touching `useSmartCube.ts`'s actual BLE calls needs manual
  testing against a real cube; keep the pure-logic parts (pattern math, routing decisions,
  solver correctness) unit-testable via injected dependencies rather than reaching for
  `navigator.bluetooth` directly, the way `syncPatternAndRoute` is structured.
