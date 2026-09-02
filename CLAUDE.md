# CLAUDE.md

Guidance for Claude Code (or any future contributor) working in this repo.

## What this is

A mobile-first PWA that pairs with a Bluetooth smart cube (GAN / QiYi / Giiker-Mijia /
GoCube), reads its live physical state, and uses that to drive several solving/practice modes:

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
- **Training** — isolated, repeatable per-case drills (OLL / PLL, plus a 2-Look drill family
  locked to small alg sets — Sune/Anti-Sune, yellow-cross algs, Aa/Ab, Ua/Ub/H/Z). A scramble
  sets up one case without leaking the solution; you solve it (physically or via an on-screen
  pad) and completion is auto-detected. Reps persist to their own Dexie table. See
  `resources/training-mode-spec.md` and the "Training mode & 2-Look drills" section below.

The full product/architecture spec this was built against lives at
`resources/cube-trainer-spec.md` — read that first for the *intended* design; a companion spec
for the Training rework is `resources/training-mode-spec.md`. This file is about the state of
the actual code and where it stands relative to that intent.

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
- **The one place moves ARE relabeled: `useCubeStore.solveTracker`** (connected Timed Solve
  CFOP detection). The raw store `pattern` can't be used there — during a guided scramble it
  becomes `default·scramble·z2·[physical scramble turns]`, a ghost that never reads as
  cross/F2L/OLL/solved on time. The tracker is a *separate* pattern seeded from the clean
  `default·scramble·z2` and advanced by `relabelMoveZ2(move)` (smart-cube events come in the
  cube's calibrated/default frame; the CFOP tables are post-z2). This is deliberately walled
  off from `pattern`/`moveHistory`/`visualAlg`. If you need "is the cube solved / what phase"
  during a connected timed solve, read `solveTracker`, not `phaseStatus`/`monotonicPhase`.
  The frame choice is empirically verified in `src/tests/solvePhaseTracker.test.ts` — re-run
  it if you touch any of this.

## Recent work (this session)

1. **Smart-cube connect flow no longer guesses.** Previously, when a cube's protocol didn't
   support reading full state back (`getPattern()` missing/failing), the app silently
   guessed the mode from stale store state instead of saying so. Now `useSmartCube.ts`'s
   `syncPatternAndRoute` distinguishes "we really read your cube" from "we don't know"
   (`SmartCubeState.stateReadSupported`) and surfaces the unknown case in the connection
   modal instead of faking a routing decision.
   - **Still-manual on connect (known, not auto-fixed):** on connecting an already-scrambled
     cube the initial `getPattern()` reads as solved (the driver reports an assumed-solved
     state until the cube is turned / its real facelet snapshot arrives), so the app routes
     to Scramble and the user has to trigger a resync. A poll-until-settled retry loop was
     tried (`readSettledPattern`) and did **not** help — reverted. Current answer is a
     manual **resync button in the header** (`Header.tsx`, shown only while connected, calls
     `useSmartCube().resyncFromCube`) so it's one tap, not open-modal-then-tap. A real
     auto-fix probably needs to listen for a full-state/facelet event from the driver
     rather than polling `getPattern()`.
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
   - **Frame follow-up (later fix):** `reconstructAlgForPattern` originally copied the z2
     dance from `solvePhasePrefix` (`pattern.applyAlg('z2')` before the solver, relabel
     after), which threw "non-oriented puzzles are not supported" and left `visualAlg` `''`
     (→ Timed/Scramble showed a solved cube). The catch: `experimentalSolve3x3x3IgnoringCenters`
     rejects *any* pattern whose centers aren't solved, and `puzzle.getPattern()` is
     facelet-derived in whatever whole-cube orientation that cube's calibration uses —
     usually the library default, but some report it z2-rotated or otherwise turned, and a
     fixed z2 (or no z2) is only ever right for one of those. Fix: `reconstructAlgForPattern`
     first finds the whole-cube rotation `rot` that lands the *centers* solved (cheap
     `CENTERS.pieces` check over `WHOLE_CUBE_ROTATIONS`, no solve), solves `pattern·rot`
     once (S), and returns `X = (rot · S)⁻¹` so `solved·X` is exactly `pattern` — the
     visualizer shows the cube as its sensor reports it and appended physical moves stay
     consistent. Verified for default / z2 / y / z' framings in `fullSolveFallback.test.ts`.
     `solvePhasePrefix` is untouched — its input genuinely is the app's post-z2 frame, so
     it keeps its single fixed z2 dance.

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
   - **Only tracks from a solved cube (later fix):** the tracker is pure move algebra that
     *assumes* it starts from solved, so turning a still-scrambled cube (connect scrambled →
     route to Timed → switch to Scramble) used to feed it junk. `useCubeStore.physicalPattern`
     (raw frame, seeded by every `getPattern()` read, advanced by every turn, never reset by
     `setScramble`) is now the "is the physical cube actually solved?" source of truth.
     `useSmartCube.ts` only feeds a turn to `scramblePartialGate` when the cube was solved
     *before* that turn (or tracking already started, `scrambleDoneMoves.length > 0`), and
     `ScrambleView`'s `awaitingSolved` ("Return your cube to the solved state") is driven off
     `isPatternSolved(physicalPattern)` rather than a `visualAlg`-length proxy.

4. **Guided scramble absorbs half-finished double turns.** A physical `R2` arrives as two
   separate `R` quarter-turn events (GAN/QiYi never emit doubles), so the first `R` used to
   flash the amber "partial" cue for the tens of ms until the second landed.
   `src/utils/scramblePartialGate.ts` (pure, dependency-injected) now sits between the BLE
   event and `applyPhysicalTrackMove` in `useSmartCube.ts`: a turn that classifies
   `partial` is *held* for `SCRAMBLE_PARTIAL_GRACE_MS` (800ms); a second turn in that window
   commits the held one and processes the new one (a real double turn resolves to `progress`
   with no amber frame), and the timer firing commits it (genuine mid-face stop → cue
   shows). `applyMove`/`visualAlg` stay immediate — only the guide lags. `progress` /
   `error` / `complete` are never deferred.

5. **Timed Solve: no spurious autostart, real inspection, and CFOP phase detection that
   actually works with a connected cube.**
   - `useTimer.ts` seeding effect (entering Timed mode, connected, idle): snapshots
     `lastMoveTimestamp` (finishing a scramble can't auto-start the solve), starts the
     inspection clock (`inspectionStartRef`, no longer clobbered by an incidental touch —
     it's set once on entry and cleared only on `resetTimer` / leaving Timed), calls
     `resetSolveTracking()`, and seeds the new phase tracker (below). Auto-start uses
     `startSolve({ preserveTracking: true })` so the first physical turn is counted.
   - **Frame fix — `useCubeStore.solveTracker`.** The raw store `pattern` is *not* usable
     for CFOP detection during a connected solve: in scramble mode it's the z2 scramble
     *target* with physical scramble turns layered on (a ghost), so `isCrossSolved` /
     `solvedSlots` / `isOLLSolved` never fire on time — "Cross" used to swallow the whole
     solve and OLL/PLL never appeared. The dedicated `solveTracker` seeds from the clean
     `default · scramble · z2` state (read live via `readActiveSmartCubePattern()` +
     `z2`, or rebuilt from `currentScramble`) and advances by `relabelMoveZ2(move)` of each
     physical turn — the one frame where phase detection tracks a real solve (verified in
     `src/tests/solvePhaseTracker.test.ts`; empirically: cross detected within ~1 move of
     the real cross, F2L slots caught, reaches solved). It's kept **entirely separate** from
     `pattern` / `moveHistory` / `visualAlg`, which stay in the raw frame so guided scramble
     and the 3D visualizer are untouched. `useTimer` reads `solveTracker` for completion
     detection, the live phase label, and telemetry move history when it's `active`.
   - `relabelMoveZ2` (`kpuzzleHelper.ts`) — face relabel across z2 (U↔D, L↔R). Smart-cube
     move events are reported in the cube's calibrated/default frame; the app's CFOP tables
     are post-z2.
   - `PhaseSplit.recognitionMs` (new) = the pause before a phase's first *real* move
     (between-phase thinking time). Monotonic detection credits the phase-*completing* move
     to the next phase, so `phaseMoves[0]` is that fast boundary move — `phaseRecognitionMs()`
     (`telemetryCalculator.ts`) therefore measures the gap before `phaseMoves[1]`, falling
     back to `[0]` for a lone-move phase and the first scored phase (cross). Measuring
     `phaseMoves[0]` directly (the original code) reported a quarter-turn's execution time
     and made every recognition look implausibly short.
   - `Solve.totalMoves` / `Solve.overallTps` (new, optional) are persisted.
   - `src/components/ui/PhaseBreakdown.tsx` (new, shared by `TimedSolveView` result panel
     and `HistoryView` detail modal) renders per-phase time / proportion% / moves / TPS, the
     `+Xs recognition` sub-line, and an overall footer. Old solves without the new fields
     render without them.
   - `src/components/ui/LivePhaseSplits.tsx` (new) — the running-solve splits panel in
     `TimedSolveView` (replaced the old hard-coded 5×`SplitRow` block; `SplitRow` deleted).
     Driven off `solveTracker.moveHistory` + the live `monotonicPhase`: each CFOP phase
     shows as upcoming / running / done, a completed phase locks in its split time, gets a
     ✓, and flashes its phase colour for ~900ms (own 100ms tick so the active phase's clock
     and the flash expiry advance between physical turns). Uses the same `phaseRecognitionMs`
     as the post-solve breakdown.

## Training mode & 2-Look drills (later session — see `resources/training-mode-spec.md`)

New **Training** tab: isolated, repeatable CFOP-phase drills. Built against
`resources/training-mode-spec.md`. OLL / PLL / F2L / Cross drills are all built; the Guided
Solve rewrite (spec §8) is still pending.

- **Shared physical-tracking pipeline, generalised.** The Scramble-mode move tracker is now
  mode-neutral so Training reuses it instead of a second copy. `useAppStore` fields renamed
  `scramble{Remaining,Done}Moves` / `scrambleFeedback` / `scrambleCorrectionActive` →
  `track{Remaining,Done}Moves` / `trackFeedback` / `trackCorrectionActive`; actions →
  `applyPhysicalTrackMove` / `clearTrackFeedback` / `resetPhysicalTrack`; new `trackTargetMoves`
  + `setTrackTarget(moves)`. `useSmartCube.ts`'s partial-gate now fires for
  `TRACKING_MODES = ['scramble', 'training']`. `scrambleTracker.ts` / `scramblePartialGate.ts`
  themselves were already sequence-agnostic and are unchanged. Scramble mode behaviour is
  identical — it just sets `trackTargetMoves` = its WCA scramble.
- **`src/solver/trainingScrambleGenerator.ts`** (worker, `GENERATE_TRAINING_SCRAMBLE`) —
  `generateCaseScramble(solvedPostZ2, precomputedCase, opts)`: builds the case state
  (`solvedPostZ2 · invSimplifiedAlg`), random AUF, then the **exact `solvePhasePrefix` z2
  dance** — `z2`, `experimentalSolve3x3x3IgnoringCenters`, relabel each solution move's face
  via `relabelMoveZ2Face` (now exported from `fullSolveFallback.ts` alongside `Z2_RELABEL`),
  invert, `simplifyMoveSequence`. Output is in the **post-z2 frame**, matcher-checkable.
  - **Spec §5 deviation:** the spec's "layer a random PLL on an OLL case for permutation
    variety" is dropped for OLL/PLL — a PLL on a *misoriented* LL permutes the orientation
    values among the 4 positions, so `matchOLL` stops identifying the case. OLL/PLL variety =
    random AUF only (the cubing.js solver is deterministic → 4 variants/case).
    `randomisePermutation` is kept for F2L (LL noise above the slot is harmless there).
- **Frame handling in `TrainingView.tsx`** (this is the z2-gotcha surface — there are tests).
  A rep carries a `frame`: `'postZ2'` (OLL / PLL / 2-Look / F2L — yellow-up, so the learner
  sees the last layer / F2L slot) or `'raw'` (Cross — white-up, so the cross forms on top).
  - `trackTargetMoves` + the connected guide + the no-cube stepping ribbon always use the
    **raw** scramble (`relabelMoveZ2` of the generator output), matching ScrambleView's white-up
    convention. `scrambleView` is the frame-native scramble for the 3D `alg` + attempt seed.
  - No-cube attempt state (`attemptPattern`) is seeded from `getPostZ2Pattern()` or
    `getDefaultPattern()` per frame; the completion predicate always runs on a **post-z2**
    pattern (`attemptPattern` directly for `'postZ2'`, `· z2` for `'raw'`). Connected always
    checks `physicalPattern · z2`. An earlier spurious extra `· z2` on the no-cube post-z2 path
    was the one real bug found — covered by `trainingScrambleGenerator.test.ts`.
  - F2L completion is `isSlotSolved(p, slot) && preservesProgress(attemptStartPostZ2, p)` —
    `attemptStartPostZ2Ref` is snapshotted on `enterAttempt`. F2L "Show solution" routes through
    the guided `findHint('f2l-1', …)` so it's AUF-correct for the live state.
- **2-Look drill family — `src/solver/twoLook.ts`** (pure). Four drills, each locked to a
  small alg set: `oll-edges` (yellow-cross algs), `oll-corners` (Sune / Anti-Sune),
  `pll-corners` (Aa / Ab), `pll-edges` (Ua / Ub / H / Z). `buildTwoLookDrills(dataset)`
  resolves alg strings + case-name pools from `cfop-algorithms.json` (a test guards drift).
  Predicates `isYellowCrossSolved` / `areTopCornersPlaced` / `isSolvedUpToAuf`.
  `solveWithAlgSet(start, algs, isDone)` — BFS over `{alg set} × AUF`, powers the "Show me"
  hint. Confirmed in data: OLL subset `"Oriented Edges"` === the 7 `twoLookRole: 'corners-only'`
  cases. `useAppStore.trainingMethod` (`'full'` | drill id) + `trainingCaseAllow` (per-case
  chip allowlist). `TrainingRep.method?` persisted.
- **F2L drill** (attempt-first, spec §6) — slot selector + case-type filter, no algorithm shown
  by default, face keypad; completion via `isSlotSolved` + `preservesProgress` (the same oracle
  the F2L fallback search uses), no new validation logic. **Cross drill** — random WCA scramble
  (`generateScramble()`), `isCrossSolved`, `solveCross` BFS on "Show cross" request; white-up
  frame (see above).
- **Persistence** — new Dexie table `trainingReps` via `db.version(2)` (additive, no data
  migration; `src/db/index.ts`). `saveTrainingRep` / `getTrainingRepsByProfile` in
  `repository.ts`, kept out of `getSolvesByProfile`'s per-render full scan. `App.tsx`'s
  profile-name effect now `try/catch`es the cold-DB open race the `version(2)` bump widened.
- Tests: `src/tests/trainingScrambleGenerator.test.ts` (all 57 OLL / 21 PLL scrambles verified
  with the production matchers as oracle; F2L drill scrambles + `matchF2L` solutions pass
  `isSlotSolved`/`preservesProgress`; Cross BFS solution in the white-up frame; both completion
  framings), `src/tests/twoLook.test.ts` (every corner case solvable by a Sune/Anti-Sune combo;
  every drill reaches its goal; predicates).

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
6. **Per-move data isn't persisted with a solve.** `Solve` records keep phase splits and
   aggregate telemetry but not the move stream itself, so History can't show a full
   reconstruction / move-by-move replay. The data exists at save time
   (`solveTracker.moveHistory` in `useTimer.ts`, `TimestampedMove[]`). Sizing is not a
   blocker (~50–60 moves/solve; a compact `moves` string + `deltaMs: number[]`, dropping the
   redundant absolute `timestamp` and the derivable `phase`, is ~1 KB/solve). The one
   caveat: `getSolvesByProfile` loads every solve for the profile on each History/stats
   render, so the move blob should live in a **separate Dexie table** keyed by solve id
   (`db.version(2)`, additive — no data migration), fetched only when a solve detail view
   opens. Populated for smart-cube solves only.
8. **Timed Solve 3D view is white-up; a "yellow face up" option is wanted (roadmap).**
   Deliberately deferred. `<twisty-player>` has no view-orientation prop and no camera angle
   shows yellow as a readable top face — it needs a true cube reorientation: prepend `z2` to
   the displayed setup **and** transform every move letter handed to the visualizer
   (`U↔D`, `L↔R`, `M↔M'`, `x↔x'`, `y↔y'`, slices, wides — `visualAlg` can contain rotations,
   see `reconstructAlgForPattern`). That move-relabel is the exact "translate every face into
   a new position" class of change that caused silent bugs before, so it must stay a pure
   `relabelForDisplay(alg)` helper used **only** in `TimedSolveView`'s render — never near the
   store, phase detection, solver, or persistence — with a unit test against a known scramble
   (per the z2 gotcha rule above). ~25 lines + test + one wiring point; contained but not
   free. Do it as its own change, not bundled with anything else.
9. **Some duplicated/vestigial pieces from incremental work:**
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
