# Training Mode & Guided Solve Rework — Spec

Companion to `CLAUDE.md` and `resources/cube-trainer-spec.md`. Read both first — this doc
assumes their conventions (one `KPattern` state model, the z2-frame handling, the solver
worker boundary) and doesn't repeat them except where directly relevant.

## 0. Why this doc exists

Guided Solve is currently the one view that doesn't follow the app's own architectural rule.
This spec diagnoses that, then proposes splitting the feature in two: a new **Training** mode
for isolated skill drills, and a **Guided Solve** that's rebuilt small and correct rather than
patched.

## 1. Problem statement

### 1a. The bug

`GuidedSolveView.tsx`'s mount effect (`initScrambleState`, lines ~24–42) never reads the live
smart-cube pattern. It only looks at `useAppStore.currentScramble` — a software scramble string
set exclusively by the Scramble tab. When Guided Solve is entered with a physical cube already
connected and scrambled:

- If `currentScramble` is empty, it calls `generateScramble()` and seeds `useCubeStore.pattern`
  from a **freshly fabricated, unrelated** scramble.
- The hint engine (`fetchHintForCurrentPhase`) computes `monotonicPhase` from that fabricated
  pattern, not the real one.
- The 3D visualizer, wired to `visualAlg`, correctly mirrors the real physical cube (per the
  Timed/Scramble work already done).

Result: two disconnected pictures of the cube on one screen. Compounded by the known
"assumed-solved until first physical read" driver quirk (see `CLAUDE.md`, "Recent work" #1) —
Scramble/Timed got a manual resync button for this; Guided Solve has no equivalent because it
was never reading the live pattern to begin with.

### 1b. The deeper design problem

Even when working, Guided Solve's format — "here's the next move, tap through it" or auto-play
every 2s — doesn't build recognition or intuition. It's a slideshow. `cube-trainer-spec.md` §5
already specifies the correct model ("hint is disposable, recomputed from real `KPattern` on
every move") — the implementation just never got built that way.

## 2. Goals

1. **Training** (new) — isolated, repeatable drills per CFOP phase (OLL, PLL, F2L, Cross first;
   order below), each built around a generated target state that doesn't leak the solving
   algorithm through the scramble itself, tracked against **real physical moves** using the
   mechanism Scramble mode already has working.
2. **Guided Solve** (rebuilt, smaller) — strictly follows `cube-trainer-spec.md` §5: hint
   recomputed from the live `KPattern` after every real move, no independent fabricated state,
   no "was that a mistake" logic.
3. Persist both. Closes `CLAUDE.md` open item #2 (Guided-mode solves are never saved).

## 3. Non-goals for this pass

- LBL timing mode (original spec §10b) — untouched.
- Full 57-case OLL / all 41 F2L cases as Training content on day one — start with the 2-look-tier
  case set already in the dataset (`twoLookRole` field), extend later.
- The yellow-up 3D view rework (`CLAUDE.md` open item #8) — unrelated, don't bundle.
- Timed Solve's phase-split telemetry — not in scope, don't touch.
- Onboarding / per-profile tier settings (`CLAUDE.md` open item #5) — separate piece of work.

## 4. Core architectural decision: reuse the Scramble pipeline, don't rebuild it

Scramble mode already correctly implements "generate a target move sequence, track real
physical turns against it, handle wrong moves and partial turns, detect completion" —
`scrambleTracker.ts`, `scramblePartialGate.ts`, and the move-matching in `useSmartCube.ts`, with
`useCubeStore.physicalPattern` as the "is the cube actually solved" source of truth. This is
tested, documented, and has already survived a couple of real bugs (see `CLAUDE.md`'s scramble
section).

Training mode's job is to feed that **same pipeline** a different kind of generated sequence — a
case-targeted scramble instead of a full WCA scramble. Do not write a second physical-tracking
layer for Training. Extend the existing one (most likely: `scrambleTracker` becomes reusable for
any move-sequence target, not just full scrambles — check whether it's already sequence-agnostic
or has Scramble-specific assumptions baked in before extending).

## 5. OLL / PLL scramble generator

New file: `src/solver/trainingScrambleGenerator.ts`. Runs in the solver worker
(`solverWorker.ts`), not the main thread — same convention as `fullSolveFallback.ts`.

Approach (already sketched in prior discussion, restated precisely here):

1. Start from the case's existing `targetPattern` (`caseMatcher.ts` already computes this per
   OLL/PLL case by inverting the case's algorithm from a solved cube).
2. Apply a random AUF (`U`/`U'`/`U2`/none).
3. Apply a random PLL algorithm from `dataset.PLL` on top. PLL algorithms by definition permute
   the last layer without touching corner/edge orientation, so this randomises permutation
   (visual noise, and — critically — makes the *same* case generate a *different* scramble each
   time) while leaving the OLL orientation pattern intact. For PLL training itself, skip this
   step (permutation IS the thing being tested) and just randomise AUF.
4. Apply the z2 dance exactly as `fullSolveFallback.ts` does before calling
   `experimentalSolve3x3x3IgnoringCenters` — apply `z2`, solve, relabel the result through
   `Z2_RELABEL`. **Do not deviate from this pattern.** `CLAUDE.md`'s cube-physics-gotchas
   section is explicit that getting this backwards produces a plausible-looking but silently
   wrong state with no type error to catch it.
5. Invert the relabeled solution. That's the scramble to display/walk through.

```ts
// src/solver/trainingScrambleGenerator.ts
import { Alg } from 'cubing/alg';
import { experimentalSolve3x3x3IgnoringCenters } from 'cubing/search';
import type { PrecomputedCase } from './caseMatcher';
import type { AlgorithmDataset } from '../types/solver';

const AUF = ['', 'U', "U'", 'U2'];
const Z2_RELABEL: Record<string, string> = { U: 'D', D: 'U', L: 'R', R: 'L', F: 'F', B: 'B' };

export async function generateCaseScramble(
  targetCase: PrecomputedCase,
  opts: { randomisePermutation: boolean; pllPool?: AlgorithmDataset['PLL'] }
): Promise<string[]> {
  let target = targetCase.targetPattern;

  const auf = AUF[Math.floor(Math.random() * AUF.length)];
  if (auf) target = target.applyAlg(new Alg(auf));

  if (opts.randomisePermutation && opts.pllPool?.length) {
    const roll = opts.pllPool[Math.floor(Math.random() * opts.pllPool.length)];
    target = target.applyAlg(new Alg(roll.algorithm));
  }

  const solution = await experimentalSolve3x3x3IgnoringCenters(target.applyAlg(new Alg('z2')));
  const moves = Array.from(solution.experimentalLeafMoves()).map((m) => {
    const s = m.toString();
    return (Z2_RELABEL[s[0]] ?? s[0]) + s.slice(1);
  });

  return new Alg(moves.join(' ')).invert().toString().split(' ');
}
```

**Correctness test, not just a smoke test:** don't test "does applying the known algorithm solve
it" (AUF/permutation are randomised independently of any single algorithm). Instead: apply the
generated scramble to a solved pattern, then run the **existing** `matchOLL`/`matchPLL` case
matcher against the result and assert it identifies the case you asked for. This reuses
production matching logic as the test oracle, which is the right thing to test against anyway
since that's what Training mode will use to detect completion.

## 6. F2L and Cross training (second phase of this work — sketch only, don't build yet)

- **F2L is attempt-first, not algorithm-first.** This is a deliberate departure from how
  OLL/PLL work, not an oversight — OLL/PLL are bounded case sets where recognise-then-recall
  *is* the skill, so showing the algorithm as primary content is correct there. F2L is the one
  phase CFOP teaches intuitively on purpose; always leading with the algorithm trains
  case-recall for a skill that's supposed to be relational/spatial reasoning, which works
  against the point of the phase. So: target pattern = one of the 164 dataset entries for a
  chosen slot, rest of F2L solved, everything above the F2L layer randomised the same way as
  OLL/PLL (AUF + random top-layer noise, irrelevant to the case being drilled) — but on
  presentation, show only the case, not the algorithm. Let the user attempt freely with
  whatever moves they choose. Validate the attempt using the **existing** `preservesProgress`
  and `isSlotSolved` from `caseMatcher.ts` (already used by the intuitive-F2L fallback search)
  — these check "did the slot get solved without wrecking anything else already solved,"
  regardless of which moves got there, so no new validation logic is needed. Surface the
  dataset algorithm only as a fallback: after N failed attempts, or an explicit "show me" tap —
  never as the default view.
- **Cross**: no fixed case set, so this isn't a case-matching drill. Likely shape: fully random
  scramble (reuse `randomScrambleForEvent('333')`, nothing new needed), track only cross
  completion via the existing `isCrossSolved`, offer the existing BFS hint **on request only**
  (button tap), not shown by default — the point is practising planning, not being shown the
  answer.

## 7. Training mode UI / state

- New view: `src/components/views/TrainingView.tsx`. Mode selector: OLL / PLL / F2L / Cross.
  Within OLL/PLL, allow filtering to a subset of cases (e.g. just Sune/Anti-sune, or a named
  bucket) rather than always drilling the full case set — this was the actual original ask.
- **No-cube tap-through fallback is required**, same as Scramble mode — Training must not
  require a connected smart cube to be usable. Without a cube: manual "Next move"/keyboard
  stepping through the generated scramble to reach the case, then (for OLL/PLL) on-screen
  move-tap input to attempt and confirm the solve; for F2L's attempt-first flow (§6), the same
  on-screen input feeds the same `preservesProgress`/`isSlotSolved` validators a connected cube
  would. One code path, two input sources — mirror how Scramble already handles connected vs.
  not, don't build a parallel no-cube implementation.
- **No auto-play anywhere in Training.** Every rep requires the user to execute it — physically
  or via manual/on-screen input — never a scripted playback. Same call applies to Guided
  Solve, §8.
- New `useAppStore` fields: `trainingSubMode`, `trainingCaseFilter`, session-scoped
  `trainingStats` (attempt count, correct streak) — session-scoped state doesn't need Dexie,
  only completed reps do.
- New Dexie table `TrainingRep` (own table, not appended to `Solve`) — timestamp, phase,
  caseName, moves, timeMs, success. Keep it a separate table for the same reason `CLAUDE.md`
  item #6 flags for per-move solve data: don't bloat the query `getSolvesByProfile` already
  runs on every History/stats render.
- Completion detection: reuse `matchOLL`/`matchPLL`/`matchF2L` against `physicalPattern` —
  same functions Guided Solve's rebuild will use, not a parallel implementation.

## 8. Guided Solve rewrite

- Delete `GuidedSolveView`'s independent scramble-fabrication effect entirely — no
  `generateScramble()` call, no `setCubeStoreScramble(currentScramble)` from app-level state.
- Seed always from the live `pattern`/`physicalPattern` in `useCubeStore` — the same source
  Scramble mode's resync logic already established as correct.
- Subscribe to real physical move events (mirror how `useSmartCube.ts` already drives Scramble
  mode's tracking) so the hint recomputes after every real move, per
  `cube-trainer-spec.md` §5. There should be no "was that the expected move" branching — every
  move just triggers "recompute hint from current real state," full stop.
- Wire `saveSolve` for `mode: 'guided'` (closes `CLAUDE.md` open item #2; the type already
  supports it, per `src/types/db.ts`).
- Leave `techniqueTier`/`notationMode` settings alone — that part already works.
- The no-cube manual path (Next-move button, keyboard stepping) is unaffected by this rewrite —
  only the connected-cube path changes.
- **Retire the auto-play walkthrough** (the `isAutoAdvancing` state, the 2-second `setInterval`
  effect, the Auto/Pause toggle button) rather than carrying it into the rewrite. It served a
  "show me what a full solve looks like" tutorial need, which is a legitimate but *different*
  need from a practice tool — scripted playback with no required input is exactly the
  low-engagement path this whole rework is trying to move away from. If a guided first-solve
  demo is wanted later, scope it explicitly as its own thing rather than reintroducing it here.
  This is a real feature removal relative to what exists today — call it out plainly when
  briefing this work, not something to silently drop.

## 9. Suggested build order

1. `trainingScrambleGenerator.ts` + unit tests. Pure logic, no hardware needed, verifiable in
   this environment's `npm test`.
2. `TrainingView` for **OLL only**, wired to the generator, the reused physical-tracking
   pipeline, and `TrainingRep` persistence. Smallest possible end-to-end slice — verify against
   a real cube before extending.
3. Extend to PLL, then F2L, then Cross.
4. Guided Solve rewrite — larger and more hardware-dependent, deliberately sequenced after
   Training proves the shared tracking pipeline works, so the rewrite has less new surface area.
5. Once the rewrite lands, remove the old fabricated-scramble code path rather than leaving it
   dead in the tree.

## 10. Manual test checklist (no BLE in CI — this all needs a real cube)

- [ ] Connect a solved cube, start OLL training, manually verify the displayed scramble does
      land on the claimed case (spot-check a handful, don't just trust the matcher on faith the
      first time).
- [ ] Confirm the same case, drilled twice in a row, produces two different scrambles.
- [ ] Physically execute a wrong move mid-drill — confirm correction behaviour matches the
      existing amber/red handling from `scrambleTracker`.
- [ ] Connect an **already-scrambled** cube, open the rebuilt Guided Solve — confirm the hint
      matches real state without a manual resync, or confirm the resync button is still
      required and surfaced (decide which is acceptable, don't leave it undefined).
- [ ] Run a full solve start to finish through rebuilt Guided Solve — confirm a `Solve` record
      is saved and shows up in History.

## 11. Decisions log

Resolved before build, kept here rather than as an open-questions section so the rationale
travels with the spec:

- **No-cube fallback: required.** Training must not require a connected smart cube — see §7.
- **F2L: attempt-first, algorithm as fallback only.** Not algorithm-first like OLL/PLL — see §6
  for why F2L is treated differently (it's the one phase CFOP teaches intuitively on purpose).
- **Auto-play walkthrough: retired, not carried forward.** See §8. It served a tutorial need,
  not a practice need, and conflicts with the "always requires real input" model both Training
  and rebuilt Guided Solve are built around. If a guided first-solve demo is wanted later, scope
  it as its own explicit feature rather than reviving this.
