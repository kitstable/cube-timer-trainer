# Cube Trainer — Rebuild Spec

Status: clean-slate rebuild. The existing codebase on disk at `C:\dev\cube-trainer` is reference
material only — useful for understanding what works and what doesn't, but no code gets carried
over as-is. See "Salvage notes" (§8) for exactly what's worth reading vs. what to actively avoid
repeating. Every reference below to "the existing app" / "the existing code" means that codebase,
not anything being built as part of this spec.

## 1. Product scope (MVP)

Two top-level features: **Scramble** and **Solve**. Solve has two modes: **Timed** and **Guided**.
Both Scramble and Solve show an on-screen visualization guiding the user through moves. Both Solve
modes teach/guide layer-by-layer CFOP (Cross → F2L → OLL → PLL).

- **No cube connected:** Timed Solve = plain two-phase timer (inspection, solve). Guided Solve =
  on-screen walkthrough only, no physical-state tracking.
- **Cube connected:** Timed Solve additionally breaks the solve into phases (cross/F2L
  slots/OLL/PLL) with inspection-time and move-time per phase, computed from real move events.
  Guided Solve shows the next phase's moves, and resyncs to whatever the physical cube actually
  did the moment the user hits "go" or turns a face — never assumes the user followed the hint
  exactly.
- **App default view:** no cube connected → Scramble. Cube connected → check solved state
  (cheap, synchronous) → Scramble if solved, Timed Solve if scrambled.
- **Guided Solve has two independent, ungated settings**: technique tier (2-look / Full PLL /
  Full CFOP, matching mainstream CFOP teaching order) and notation mode (Simplified / Standard,
  this app's own onboarding scaffold) — see §10. Neither setting is a prerequisite for the other,
  and neither is earned or unlocked; they're preferences the user sets directly.
- **Timed Solve can optionally track LBL instead of F2L** for the bottom-two-layers phase split —
  timing/telemetry only, no hints, no tier system, no algorithm database. See §10b.
- No coaching/critique/training feedback in MVP (explicitly descoped, unlike the existing app's
  telemetry/critique engine — that's a fast-follow, not MVP).
- Mobile-first responsive UI, installable PWA.
- No account system, no backend, no cloud sync for MVP — everything local (IndexedDB). Profiles
  are local named buckets for organizing saved solves, not authenticated accounts.

## 2. Stack

- **React + TypeScript + Vite**, deployed as an installable PWA (vite-plugin-pwa / Workbox)
- **cubing.js** (`cubing/bluetooth`, `cubing/kpuzzle`, `cubing/twisty`, `cubing/scramble`,
  `cubing/search`) — BLE driver, 3D visualization, WCA scrambling, and solving primitives.
  Confirmed working against the QiYi cube already; the Xiaomi cube is very likely a
  Mijia/Giiker-protocol cube, which `cubing/bluetooth` also implements — verify on first real
  hardware test, not a research blocker.
- **Zustand** for app state (single store holding: connection status, live `KPattern`, current
  mode, current phase, move log)
- **Dexie** (IndexedDB) for local persistence — profiles, solves, phase splits
- **Tailwind CSS**
- Solver-heavy work (full-solve computation for Guided mode, OLL/PLL case search if not doing
  direct lookup) runs in a **Web Worker**, never on the main thread

## 3. Core architectural rule: one state model

**`KPattern` (from `cubing/kpuzzle`) is the only representation of cube state anywhere in the
app.** No parallel hand-rolled edges/corners class. Every module — cross detection, F2L detection,
OLL/PLL matching, "is solved" checks, phase-boundary detection — reads directly from `KPattern` or
from thin, stateless helper functions that take a `KPattern` in and return a fact out (a boolean,
a list of solved slots, a matched case ID). No module owns a second copy of "what state is the
cube in."

This is the single most important divergence from the existing app, and the direct fix for why it
accumulated so much reconciliation logic: two competing models of the same cube inevitably drift,
and every drift became a special case (z2 remap tables, pending-move net-effect checks, a
solver-round-trip just to convert formats). With one model, most of that class of bug is
structurally impossible.

Orientation (which the existing app handled via a `isPostZ2` flag + move-remap table) is just
whatever the current `KPattern` says — there is no separate "have we flipped" boolean to keep in
sync. If the UI wants to prompt a physical z2 flip as part of the Cross walkthrough, that's a
scripted instruction like any other move sequence, not a mode the rest of the app needs to know
about.

## 4. Layered architecture

1. **BLE Driver Layer** — `cubing/bluetooth`'s `connectSmartPuzzle()`. Not our code. Normalizes
   vendor GATT payloads into move events and a readable `KPattern`.
2. **Cube State Store** (Zustand) — holds the current `KPattern`, updated on every move event
   (from BLE, or from manual on-screen input when no cube is connected) and derives nothing else
   itself; it's a plain data holder, not where logic lives.
3. **Phase Detection** — pure functions `KPattern -> PhaseStatus` for: is cross solved, which F2L
   slots are solved (and in what order), is OLL solved, is PLL solved. Called on every move event
   for live tracking (must be cheap and synchronous — no solver calls in this path).
4. **Solver/Hint Core** (Web Worker) — for Guided mode: given current `KPattern` and current
   phase, produce a move sequence for that phase.
   - **Cross:** BFS/IDA* over a reduced cross-only state space (this part of the existing app's
     approach was sound — reimplement against `KPattern` instead of the custom `CubeState`).
   - **F2L, OLL, PLL: all case-database lookup, not search.** Originally scoped F2L as a custom
     search solver, but a full 41-case F2L set (with all 4 slot variants = 164 entries, covering
     every starting configuration including pieces already stuck in the slot) turns out to be
     just as enumerable as OLL/PLL — see §9, "Algorithm dataset," for the actual data. So all
     three last-two-layer-ish steps use the same mechanism: normalize the live `KPattern` (bring
     the target slot/orientation to a canonical position via whole-cube rotation, check against
     each known case under the 4 possible AUF rotations), find the matching case, return its
     stored algorithm rotated back into the real orientation. No search algorithm needed anywhere
     in the Solver Core except Cross (which genuinely has too many slot combinations to enumerate
     as fixed cases the way single-slot F2L pairs can be).
   - Case *matching* itself needs no separately-authored "recognition pattern" data: each case's
     target `KPattern` is generated computationally by applying the case's own algorithm,
     inverted, to a solved cube. Matching is comparing patterns, not maintaining a second
     human-recognition dataset alongside the algorithms.
   - Full-solve computation for Guided mode (all four phases ahead of time) only runs when the
     user actually enters Guided mode, with a brief "Calculating guidance…" state — never
     speculative, never blocking Scramble or Timed mode.
5. **Analytics/Telemetry** — inter-move timestamp deltas → TPS, pause ratio, phase-duration
   splits. The existing app's `telemetryEngine.ts` formulas (TPS, pause ratio, phase %) are directionally
   fine to reuse conceptually; the gap is that they aren't currently wired to persisted solves —
   for the rebuild this becomes: compute at solve-end, write to Dexie as part of the `Solve`
   record.
6. **Visualization** — `<twisty-player>` for the 3D view (mirrors either the live physical state,
   or a scripted target sequence for Scramble/hint display). Skip the existing app's hand-rolled SVG
   net/isometric renderer for MVP — one visualization surface is enough to start; revisit if
   `<twisty-player>` proves insufficient for a specific hint-highlighting need.
7. **UI Shell** — Scramble / Timed Solve / Guided Solve screens, Profile/History views, routed
   via the default-mode logic in §1.

## 5. Guided mode: "reset to physical state" mechanics

Because state lives in exactly one place (§3), this behavior is close to free:

1. Hint Core computes a move sequence for the current phase from the current `KPattern`.
2. UI displays it as a target overlay.
3. The moment a real move event arrives (BLE) — or the user taps "next"/"go" — the Cube State
   Store updates to the new real `KPattern`. This is ground truth, always.
4. Phase Detection re-checks the new `KPattern` against the current phase's completion condition.
   If satisfied, advance to the next phase and request a fresh hint for it. If not, and the move
   didn't match what was expected, just request a fresh hint from the new actual state — there is
   no "was that a mistake" judgment call to make, because there's no separate prediction being
   protected. The hint is disposable by design.

No merge/reconciliation logic is needed because there's nothing to reconcile — the hint was never
a second source of truth, just a suggestion computed from the one real state.

## 6. Data model (Dexie / IndexedDB)

```ts
interface Profile {
  id: string;
  name: string;
  createdAt: number;
}

interface Solve {
  id: string;
  profileId: string;
  scrambleMoves: string[];
  mode: 'timed' | 'guided';
  method: 'F2L' | 'LBL';         // bottom-two-layers tracking scheme, see §10b — always 'F2L' for
                                  // no-cube-connected solves and for all Guided-mode solves
  techniqueTier?: '2look' | 'fullPLL' | 'fullCFOP';   // Guided mode only, see §10
  notationMode?: 'simplified' | 'standard';            // Guided mode only, see §10
  cubeConnected: boolean;       // did this solve have phase-level detail or just two phases?
  phases: PhaseSplit[];
  totalTimeMs: number;
  dnf?: boolean;
  createdAt: number;
}

interface PhaseSplit {
  name: 'inspection' | 'cross'
      | 'f2l-1' | 'f2l-2' | 'f2l-3' | 'f2l-4'   // when method === 'F2L'
      | 'lbl-corners' | 'lbl-edges'             // when method === 'LBL', see §10b
      | 'oll' | 'pll';
  startTs: number;
  endTs: number;
  moveCount: number;
  tps?: number;         // only when cube connected
  pauseRatio?: number;  // only when cube connected
}
```

No-cube-connected solves only ever produce two `PhaseSplit`s (`inspection`, and a single combined
`solve` phase covering everything after) — the schema doesn't need a separate shape for that case,
just fewer/simpler entries.

## 7. Snappy-UI rules

- Scramble generation and cross-solve: cheap enough to not need a worker, but route through one
  anyway for consistency and future headroom.
- F2L/OLL/PLL full-solve computation (Guided mode entry): **always** in a Web Worker, always with
  a visible "Calculating…" state — this is the one place real computation time is expected and
  should be surfaced honestly rather than hidden or blocked on.
- Live phase detection during Timed/Guided solving: must be synchronous, pure-function checks
  against `KPattern` — no solver calls in the per-move hot path, full stop.
- Default-mode check on load/connect (§1): a single `KPattern.experimentalIsSolved(...)` call —
  cheap, synchronous, no solver involved.

## 8. Salvage notes — what to read vs. avoid from the existing codebase (C:\dev\cube-trainer)

**Worth reading for reference (concept, not code):**
- `useSmartCube.ts` — the connect/disconnect/move-event wiring around `cubing/bluetooth` is a
  reasonable shape for a React hook; re-derive it clean against the new single-state-model design
  rather than copying, since it currently carries `isPostZ2`/`setPostZ2` plumbing that shouldn't
  exist in the rebuild.
- The Cross BFS solver's *approach* in `cubeEngine.ts` (packed-state BFS, pick most human-friendly
  solution among optimal-depth options) — reimplement against `KPattern`.
- `telemetryEngine.ts`'s TPS/pause-ratio/phase-percentage formulas — the math is fine, reuse the
  concepts.
- `CLAUDE.md` — genuinely useful engineering log of cube-physics gotchas (e.g. the `"R2'"` modifier
  parsing bug, Reid-order corner-orientation mismatch) worth being aware of even when not reusing
  the code that hit them.

**Actively avoid repeating:**
- The hand-rolled `CubeState` class (edges/corners arrays + custom move-transition tables) — this
  is exactly the parallel-state-model problem described in §3. It has a confirmed unfixed
  corner-orientation bug and shouldn't be resurrected in any form.
- `isPostZ2` / `remapMoveThroughZ2` / any move-remapping-through-orientation-flag pattern.
- `pendingMovesRef` net-effect reconciliation — a symptom of the same root problem, not needed
  once there's one state model.
- The canned, non-scramble-aware F2L "solver" — don't port it even as a placeholder; the real
  case-matching approach (§4, §9) isn't meaningfully more work, so there's no reason to ship the
  wrong-answer placeholder even temporarily.

## 9. Algorithm dataset (decided)

`cfop-algorithms.json` (shipped alongside this spec) contains all 57 OLL cases, 21 PLL cases, and
164 F2L entries (41 standard cases × 4 slot variants), adapted from `poliva/cubedex`
(MIT-licensed, Copyright (c) 2024 Pau Oliva Fora — same author as the `smartcube-web-bluetooth`
library referenced earlier; that project is also built on cubing.js, for what it's worth as a
second data point that this stack choice is well-trodden). Each entry is `{name, subset,
algorithm}`; no separate recognition-pattern data is included or needed, per §4's note on
generating target patterns computationally instead. This file is a direct dependency the app
loads and matches against — not a reference to reimplement, unlike the "salvage notes" material
in §8.

The file also carries `twoLookRole` tags on each OLL/PLL entry and a small `OLL_2LOOK_EDGE_ORIENTATION` set -- see §10 for what these mean and how the guided-solve difficulty tiers use them.

## 10. Guided-solve settings: technique tier and notation mode

**Two fully independent settings, neither one a gate.** Earlier drafts of this section bundled
"which moves you can read" and "how advanced your technique is" into one linear ladder. That's
wrong: a solver can be completely comfortable with wide moves and rotations while still building
up from 2-look last layer, or vice versa. Bundling them meant comfort on one axis would silently
cap access to the other — exactly what this app should not do. There is no unlock mechanic on
either setting: both are just user-chosen preferences, changeable at any time, not achievements
earned by solve count or performance. The app's job is to support the user's actual current level
honestly, not to gate progress behind its own assumptions about readiness.

### Axis 1 — Technique tier (matches mainstream CFOP teaching order)

Confirmed against how CFOP is actually taught in the community (J Perm, CubeSkills, and most
learning-order guides converge on this exact sequence): cross stays intuitive the whole way up (no
tier — even world-class solvers solve it by lookahead, not a memorized case set), F2L stays
intuitive with an increasing rotationless-preference, and the last layer graduates through:

1. **2-look**
   - OLL solved in two sequential sub-steps: (a) orient edges into a cross — one of 3 short
     algorithms not part of the standard 57-case set (Dot/Line/L-shape, see
     `cfop-algorithms.json`'s `OLL_2LOOK_EDGE_ORIENTATION`), then (b) orient corners — the 7 cases
     tagged `twoLookRole: "corners-only"` in the dataset's `OLL` array (Sune, Anti-Sune, H, Pi, U,
     T, L). 10 algorithms total.
   - PLL solved in two sequential sub-steps: (a) permute corners — `Aa Perm` / `Ab Perm` only, (b)
     permute edges — `Ua Perm` / `Ub Perm` / `H Perm` / `Z Perm` only. 6 algorithms total.
   - F2L: case-matched per §4/§9, rotations shown freely (no rotationless preference yet).
   - **Hard rule: no algorithm outside these 16 may ever be shown for OLL/PLL at this tier.** In
     particular, `T Perm`, `Y Perm`, `F Perm`, any `J`/`R`/`G`/`N` perm, `V Perm`, and `E Perm` are
     structurally full-PLL-only (the 15 cases where corners and edges permute simultaneously — the
     thing 2-look explicitly avoids) and must never appear here regardless of how "easy" any one
     individually seems.
2. **Full PLL**
   - OLL: unchanged 2-look procedure.
   - PLL: full single-step 1-look — all 21 cases, sourced algorithm as-is.
   - F2L: case-matched, now with a **rotationless-preferred sequencing rule** — when solving into
     back slots (BR/BL), prefer the matched case's algorithm variant that avoids a `y`/`y'`
     rotation (back-slot generator moves like `R' U' R` / `L' U' L`, per the uploaded research
     doc's §1) over a front-slot-framed variant of the same case, when both exist in the dataset
     for that slot.
   - This is the standard next step recommended by virtually every mainstream CFOP tutorial: 21
     cases is a smaller memorization jump than 57, and it removes the corner-then-edge two-step
     entirely for PLL, the bigger per-solve time cost of the two.
3. **Full CFOP**
   - OLL: full single-step 1-look, all 57 cases, sourced algorithm as-is.
   - PLL: unchanged (already full since tier 2).
   - F2L: same rotationless-preferred sequencing as tier 2. Genuine "Advanced F2L" (multi-slotting,
     trapped-piece-specific algorithms solving in 6–8 moves instead of 12–15, per the research
     doc's stage 4) is **explicitly out of scope** — it needs search across multiple slots
     simultaneously rather than the single-case lookup §4/§9 settled on, a genuinely bigger
     solver-engineering lift than anything else here. Worth a fast-follow if it turns out to
     matter, not part of the MVP ladder.

### Axis 2 — Notation mode (this app's own onboarding scaffold, not a community-standard stage)

Worth being honest about this one: nowhere in mainstream cubing pedagogy does anyone formally gate
wide moves or whole-cube rotations behind a skill stage — tutorials just use whatever moves an
algorithm needs from day one, because most people pick up the physical technique by imitating a
video rather than reading notation cold. This axis exists because *this app specifically* shows
notation as text/visualization rather than video, and that's a real, first-encounter stumbling
block worth smoothing over — but it's this app's own accommodation, not "how cubers learn," and it
should never be presented to the user as a prerequisite stage they must pass through.

1. **Simplified** — single-layer turns only (`U D L R F B`, with `'`/`2`). No wide moves, no
   whole-cube rotations, in any phase, including Cross's search-generated hints.
2. **Standard** — wide moves (`f l d r u b`) and whole-cube rotations (`x y z`) shown normally, per
   whatever the active technique tier's case-matching naturally produces.

Every technique tier works with either notation mode — including, if it ever comes up, Full CFOP
at Simplified notation, even though virtually nobody would actually combine those in practice.
Allowing all combinations uniformly is simpler and more correct than trying to special-case which
pairings "make sense."

### Defaults, not gates

A new profile should start wherever the user says they're at — a simple, direct onboarding
question ("Have you learned F2L yet?" / "Are you comfortable with wide-move and rotation
notation?"), not an assumed floor of "everyone starts at 2-look + Simplified." Both settings stay
visible and changeable in-app at all times, not hidden behind a "first learn this" screen.

### Move-vocabulary data requirement (new work, generated not authored)

A meaningful fraction of the sourced `cfop-algorithms.json` entries only have a wide-move or
rotation-based solution on file — e.g. `Aa Perm` is sourced as `x (R' U R') D2 (R U' R') D2 R2 x'`,
with no single-layer-only alternative stored. Simplified notation mode needs a genuinely different
solution string for these, not a simpler-looking pick from the existing set, and needs it
independent of whichever technique tier is active (a Full-CFOP-tier user on Simplified notation
still needs single-layer-only versions of all 57 OLL cases, not just the 2-look 10).

This is **generated, not authored** — the same trust level as the case-pattern generation already
relied on in §4, just a move-set-restricted search instead of an unrestricted one: for each
affected case, run a search (BFS/IDA*, via `cubing/kpuzzle` + `cubing/search` or an equivalent)
constrained to the 18-move single-layer generator set (`U/U'/U2/D/D'/D2/L/L'/L2/R/R'/R2/F/F'/F2/
B/B'/B2`) that reproduces the same net cube-state transformation as the case's canonical
algorithm. This is a one-time, offline computation — run it once, cache the results as an
additional field on the existing dataset entries (e.g. `algorithmSimplified`, falling back to the
existing `algorithm` field where the sourced version already satisfies the constraint), not
something computed at runtime or re-derived per session. Given the full case set now needs
covering (all 57 OLL, all 21 PLL, all 164 F2L entries — not just the 2-look subset, since notation
mode is independent of technique tier), this is meaningfully more computation than the earlier
draft scoped, but it's still the same one-time, cacheable, generated task. Good candidate for
Antigravity to run directly, since it already has `cubing.js` and a JS toolchain available.

**Explicitly zero runtime cost.** `algorithmSimplified` must be a pre-baked field in the shipped
`cfop-algorithms.json`, generated once as a build/data-prep step, never computed live per hint
request — the app just reads a string field either way, same as it already does for `algorithm`.
If this ever ends up being computed on the fly at runtime instead of read from the dataset, that's
a direct violation of §7's snappy-UI rule and should be treated as a bug, not a performance
trade-off.

### Implementation note

This needs **no change to the data model in §6 beyond what's already there** —
`PhaseSplit` still just records `'cross'`, `'f2l-1'`..`'f2l-4'`, `'oll'`, and `'pll'` as phase
names regardless of either setting; a solve's recorded phase timing doesn't care which algorithm
variant or move vocabulary was shown. The Solver/Hint Core (§4) reads both settings independently
at each case-matching step: technique tier picks which case set is eligible to match against (per
axis 1's rules), notation mode picks which algorithm field to read off the matched case
(`algorithm` vs `algorithmSimplified`). These are two independent lookups, not a combined branch.

## 10b. LBL — timing mode only, not part of Guided mode

Layer-by-Layer is supported **only as an alternative phase-tracking scheme inside Timed Solve**,
for someone who already knows LBL and wants granular timing without wanting the app to teach them
anything. It gets no hints, no algorithm database, no Guided-mode tier — it's a labeling choice
over the same live `KPattern` stream everything else already reads from.

- **Timed Solve gains a method setting**: `F2L` (default — bottom-two-layers split into
  `f2l-1`..`f2l-4` as already specced) or `LBL` (bottom-two-layers split into two phases instead:
  `lbl-corners`, then `lbl-edges`).
- **Phase completion conditions** (both cheap, synchronous `KPattern` checks, no solver involved,
  consistent with §7's snappy-UI rule):
  - `lbl-corners` complete: the entire bottom layer is solved (all four bottom corners correctly
    placed and oriented, in addition to the already-cross-complete bottom edges).
  - `lbl-edges` complete: the first two layers are fully solved — identical terminal condition to
    "F2L complete" in the F2L method, just reached via a different move pattern and tracked as one
    combined phase instead of four per-slot ones.
- OLL and PLL phases afterward are **completely unaffected** by which bottom-two-layers method was
  used — same phases, same completion checks, same difficulty-tier system from §10, independent of
  whether the solver got there via F2L or LBL.
- §6's `PhaseSplit.name` union gains `'lbl-corners'` and `'lbl-edges'` as valid values, used only
  when a solve's `method` field (also new) is `'LBL'` rather than `'F2L'`.

## 11. Visual design direction

Dark UI, mobile-first, using calibrated speedcubing sticker tones (not raw RGB) mapped to actual
app structure rather than used decoratively. Reference mockup: `design-mockup.html` (Guided Solve
and Timed Solve screens).

### Palette

```
--bg:         #101116   page background — near-black graphite, not pure black
--surface:    #1A1C23   cards, panels
--surface-2:  #22252E   nested/elevated surfaces, current-tab fill
--border:     #2C2F3A   hairline borders
--text:       #F3F1EA   primary text — soft warm white, not pure #FFF
--text-muted: #8A8E9C   secondary text

--white:  #F3F1EA   (shared with --text — the cube's white sticker)
--yellow: #FFD500
--gold:   #E8A200   (distinct from yellow — reserved for PLL, see below)
--red:    #C8102E
--orange: #FF6D1F
--blue:   #0057B8
--green:  #009A44
```

### Color-to-structure mapping (the one non-negotiable design rule)

Cube colors are status/progress indicators tied to CFOP's real structure, not decoration:
- **Cross** → white
- **F2L slots 1–4** → the four side colors (green/red/blue/orange), one per slot, in the order
  each slot is actually solved
- **OLL** → yellow
- **PLL** → gold (`#E8A200`) — deliberately a distinct shade from OLL's yellow, both being
  "last layer" but needing visual separation
- Any phase-rail, progress indicator, or status chip in the app should draw from this mapping
  rather than inventing a new color-to-meaning association elsewhere in the UI.

### Type

- **Space Grotesk** (500/600 weight) — headings, labels, button text. Chosen for its squared
  letterforms/apertures, which echo the cube's own square facelets — a deliberate thematic tie,
  not a generic geometric-sans pick.
- **JetBrains Mono** (500 weight, tabular figures) — anything numeric or move-notation: timer
  digits, phase-split times, move-hint strings (`R U R'`). Monospace keeps digits from jittering
  as they update and keeps move-notation glyphs aligned.
- **Inter** — body text, secondary labels. Quiet by design; it's not carrying the app's
  personality, Space Grotesk and JetBrains Mono are.

### Layout principles

- **Bottom-anchored primary actions.** This app is used one-handed (the other hand is holding the
  physical cube) — the primary CTA ("Next move," "Stop," "Start") always sits in comfortable
  thumb reach near the bottom of the screen, not top-anchored like a typical content app.
  Reference the two `design-mockup.html` screens directly for the row placement of connection
  status, tab switcher, visualization, hint/timer, phase rail, and CTA.
- **Cube visualization gets a dedicated card**, not a bare canvas floating on the page background
  — consistent `surface` card treatment with rounded corners.
- **Flat surfaces, no gradients/glow/blur.** Matches the snappy-UI performance goal from §7 as
  much as it's an aesthetic choice — decorative effects cost paint time for no functional benefit
  here.
- **Sticker rendering:** small `border-radius` (not fully rounded, real stickers are subtly
  rounded squares), 3px gaps, matte flat fills, no per-sticker shadow or gloss effect. The
  "next move" target sticker gets a 2px inset outline in `--text` — the one allowed visual
  emphasis technique, reserved for that single purpose so it stays meaningful when used.

## 12. Open items for next working session

- Confirm Xiaomi cube's actual BLE protocol once both cubes are testable (likely Giiker, per
  `cubing/bluetooth`'s existing support — not expected to need new driver work, but unverified).
- Exact phase-boundary detection rules for cross-complete / F2L-slot-complete (straightforward,
  but worth spelling out precisely before handing to a coding tool).
- Case-matching implementation details: precompute all 57+21+164 target `KPattern`s once at app
  load (cheap, done in the Worker) vs. compute lazily per-match — precompute is almost certainly
  fine given the small case count, but worth confirming it doesn't add noticeable startup delay.
- `lbl-corners`-complete detection (§10b): needs a precise "full bottom layer solved" check against
  `KPattern` — straightforward, but hasn't been written out as exactly as the other phase-boundary
  rules yet.
- **Run the `algorithmSimplified` generation pass from §10** across the full dataset (all 57 OLL,
  21 PLL, 164 F2L entries — not just the 2-look subset, since notation mode is independent of
  technique tier) before Simplified notation mode can be considered complete. This is the biggest
  concrete to-do out of everything in this spec, not a minor detail. Also confirm the F2L
  dataset's existing rotation-framed vs. rotationless-framed variant coverage per case/slot while
  doing this pass, since Full PLL/Full CFOP's rotationless-preference rule and Simplified
  notation's restricted-search generation both touch the same underlying question (which cases
  only have a rotation-dependent solution on file).
