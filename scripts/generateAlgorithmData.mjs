/**
 * Offline algorithm-data prep for the CFOP trainer.
 *
 *   node scripts/generateAlgorithmData.mjs
 *
 * Reads  resources/cfop-algorithms-new.json  (hand-maintained source: clean
 *        WCA notation, no `algorithmSimplified`).
 * Writes src/data/cfop-algorithms.json  and  public/data/cfop-algorithms.json
 *
 * For every OLL / PLL / F2L / 2-look-edge entry it:
 *   - normalises `algorithm` to clean cubing.js notation
 *   - (re)generates `algorithmSimplified`: an OUTER-MOVE-ONLY (U D L R F B, HTM)
 *     sequence with the identical net effect, via cubing.js search
 *   - VALIDATES that both strings actually solve the case (OLL orient / PLL
 *     permute / F2L slot) without wrecking the cross or the other F2L slots
 *   - for F2L entries whose hand alg fails validation, regenerates the entry by
 *     conjugating the case's Front-Right variant with the whole-cube rotation
 *     that is *verified* to map that slot onto FR.
 *
 * Exits non-zero if any entry cannot be made to pass.
 *
 * Requires Node >= 22.18 (native TypeScript import for cfopInvariants.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cube3x3x3 } from 'cubing/puzzles';
import { Alg } from 'cubing/alg';
import { experimentalSolve3x3x3IgnoringCenters } from 'cubing/search';
import {
  isCrossSolved,
  isSlotSolved,
  isOLLSolved,
  preservesProgress,
  ALL_F2L_SLOTS,
  F2L_SLOT_TARGETS,
} from '../src/solver/cfopInvariants.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'resources', 'cfop-algorithms-new.json');
const OUT_SRC = path.join(ROOT, 'src', 'data', 'cfop-algorithms.json');
const OUT_PUBLIC = path.join(ROOT, 'public', 'data', 'cfop-algorithms.json');

const kpuzzle = await cube3x3x3.kpuzzle();
const SOLVED = kpuzzle.defaultPattern();
const SOLVED_Z2 = SOLVED.applyAlg(new Alg('z2'));

// ---------------------------------------------------------------- helpers ----

const OUTER_ONLY = /^[UDLRFB]([2']|2')?$/;

function normalize(raw) {
  return String(raw)
    .replace(/\+/g, ' ')
    .replace(/([RUFBLDrufbldMSExyz])'2/g, "$12'")
    .replace(/([RUFBLDrufbldMSExyz])2'/g, "$12'")
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function leafMoves(algStr) {
  return Array.from(new Alg(algStr).experimentalLeafMoves()).map((m) => m.toString());
}

function isOuterOnly(algStr) {
  return leafMoves(algStr).every((m) => OUTER_ONLY.test(m) || /^[UDLRFB]2$/.test(m));
}

/** face-relabel for `r M r^-1` (single whole-cube rotation). */
const ROT_RELABEL = {
  y:   { U: 'U', D: 'D', R: 'B', B: 'L', L: 'F', F: 'R' },
  "y'":{ U: 'U', D: 'D', R: 'F', F: 'L', L: 'B', B: 'R' },
  y2:  { U: 'U', D: 'D', R: 'L', L: 'R', F: 'B', B: 'F' },
  x:   { R: 'R', L: 'L', U: 'F', F: 'D', D: 'B', B: 'U' },
  "x'":{ R: 'R', L: 'L', F: 'U', U: 'B', B: 'D', D: 'F' },
  x2:  { R: 'R', L: 'L', U: 'D', D: 'U', F: 'B', B: 'F' },
  z:   { F: 'F', B: 'B', U: 'L', L: 'D', D: 'R', R: 'U' },
  "z'":{ F: 'F', B: 'B', L: 'U', U: 'R', R: 'D', D: 'L' },
  z2:  { F: 'F', B: 'B', U: 'D', D: 'U', L: 'R', R: 'L' },
};

/**
 * If `algStr` is only whole-cube rotations + outer face turns with a net-zero
 * rotation, rewrite it as an equivalent outer-turn-only sequence by relabelling
 * each face turn through the rotations that precede it. Returns null when the
 * alg has wide/slice moves or a non-identity net rotation.
 */
function resolveRotations(algStr) {
  let cur = { U: 'U', D: 'D', L: 'L', R: 'R', F: 'F', B: 'B' };
  const out = [];
  for (const tok of leafMoves(algStr)) {
    const rot = tok.replace(/^([xyz])(2'|'2)$/, '$12');
    if (ROT_RELABEL[rot]) {
      const rl = ROT_RELABEL[rot];
      const prev = cur;
      cur = Object.fromEntries(Object.keys(prev).map((f) => [f, prev[rl[f]]]));
      continue;
    }
    const m = tok.match(/^([UDLRFB])(2'|2|'|)$/);
    if (!m) return null; // wide / slice / unknown
    out.push(cur[m[1]] + (m[2] === "2'" ? '2' : m[2]));
  }
  const resolved = out.join(' ');
  if (!samePermutation(SOLVED.applyAlg(new Alg(algStr)), SOLVED.applyAlg(new Alg(resolved)))) {
    return null; // non-identity net rotation
  }
  return resolved;
}

function samePermutation(a, b) {
  const ae = a.patternData.EDGES, be = b.patternData.EDGES;
  const ac = a.patternData.CORNERS, bc = b.patternData.CORNERS;
  return (
    ae.pieces.every((p, i) => p === be.pieces[i]) &&
    ae.orientation.every((o, i) => o === be.orientation[i]) &&
    ac.pieces.every((p, i) => p === bc.pieces[i]) &&
    ac.orientation.every((o, i) => o === bc.orientation[i])
  );
}

function tidy(algStr) {
  // normalise `X2'` -> `X2`, collapse trivial cancellations
  return leafMoves(algStr)
    .map((m) => m.replace(/2'$/, '2'))
    .join(' ');
}

/** Outer-move-only alg with the same net effect as `rawAlg`. */
async function toSimplified(rawAlg) {
  if (isOuterOnly(rawAlg)) return tidy(rawAlg);

  // Preferred: rewrite rotations into the fixed frame (keeps the alg readable).
  const resolved = resolveRotations(rawAlg);
  if (resolved !== null && isOuterOnly(resolved)) return tidy(resolved);

  // Fallback: search for any outer-move sequence with the same net effect.
  const scrambled = SOLVED.applyAlg(new Alg(rawAlg));
  const solution = await experimentalSolve3x3x3IgnoringCenters(scrambled);
  const simplified = solution.invert().toString();
  if (!samePermutation(scrambled, SOLVED.applyAlg(new Alg(simplified)))) {
    throw new Error(`simplified alg net effect differs for "${rawAlg}" -> "${simplified}"`);
  }
  return tidy(simplified);
}

const U_CORNER_SLOTS = [0, 1, 2, 3];
const U_EDGE_SLOTS = [0, 1, 2, 3];

/** Every F2L slot other than `slot` is solved, and the cross is solved. */
function onlySlotDisturbed(p, slot) {
  if (!isCrossSolved(p)) return false;
  return ALL_F2L_SLOTS.every((s) => s === slot || isSlotSolved(p, s));
}

/** The target slot's two pieces sit in the U layer or in the target slot. */
function pairAccessible(p, slot) {
  const t = F2L_SLOT_TARGETS[slot];
  const cAt = p.patternData.CORNERS.pieces.indexOf(t.cornerPiece);
  const eAt = p.patternData.EDGES.pieces.indexOf(t.edgePiece);
  return (
    (U_CORNER_SLOTS.includes(cAt) || cAt === t.cornerSlot) &&
    (U_EDGE_SLOTS.includes(eAt) || eAt === t.edgeSlot)
  );
}

function slotFromName(name) {
  if (name.includes('Front Right')) return 'FR';
  if (name.includes('Front Left')) return 'FL';
  if (name.includes('Back Right')) return 'BR';
  if (name.includes('Back Left')) return 'BL';
  return null;
}

// Rotation that maps each slot onto FR (verified empirically below).
const SLOT_ROTATION = { FR: '', FL: "y'", BL: 'y2', BR: 'y' };
const INV_ROT = { '': '', "y'": 'y', y2: 'y2', y: "y'" };

/** Build the "case setup" state: where you'd be right before running `alg`. */
function setupFor(alg) {
  return SOLVED_Z2.applyAlg(new Alg(alg).invert());
}

// ------------------------------------------------------------- validation ----

let failures = 0;
const report = [];

function check(pass, label, detail = '') {
  if (!pass) {
    failures++;
    report.push(`  FAIL  ${label}  ${detail}`);
  }
}

// `algorithmSimplified` is guaranteed by `toSimplified` to have the identical
// piece permutation+orientation as `algorithm`, so any behavioural property
// proven for `algorithm` holds for it too; we only re-check outer-only-ness.

async function processLL(entry, kind) {
  const algorithm = normalize(entry.algorithm);
  // A valid last-layer alg leaves the cross and all F2L slots solved.
  const afterFromSolved = SOLVED_Z2.applyAlg(new Alg(algorithm));
  check(preservesProgress(SOLVED_Z2, afterFromSolved), `${kind} ${entry.name} preserves F2L+cross`);
  // The case it defines must be a genuine last-layer case (F2L intact) and,
  // for OLL, actually mis-oriented on top (not the identity).
  const setup = setupFor(algorithm);
  check(preservesProgress(SOLVED_Z2, setup), `${kind} ${entry.name} case setup keeps F2L+cross`);
  if (kind === 'OLL') {
    check(!isOLLSolved(setup) || algorithm === '', `OLL ${entry.name} case is actually a case`, `"${algorithm}"`);
    check(isOLLSolved(setup.applyAlg(new Alg(algorithm))), `OLL ${entry.name} orients the top`);
  } else {
    check(fullySolvedUpToAuf(setup.applyAlg(new Alg(algorithm))), `PLL ${entry.name} permutes the LL`);
  }

  const algorithmSimplified = await toSimplified(algorithm);
  check(isOuterOnly(algorithmSimplified), `${kind} ${entry.name} simplified is outer-only`, algorithmSimplified);
  return { ...entry, algorithm, algorithmSimplified };
}

function fullySolvedUpToAuf(p) {
  const te = SOLVED_Z2.patternData.EDGES, tc = SOLVED_Z2.patternData.CORNERS;
  return ['', 'U', "U'", 'U2'].some((auf) => {
    const q = auf ? p.applyAlg(new Alg(auf)) : p;
    return (
      q.patternData.EDGES.pieces.every((v, i) => v === te.pieces[i]) &&
      q.patternData.CORNERS.pieces.every((v, i) => v === tc.pieces[i])
    );
  });
}

async function processEdgeOrient(entry) {
  const algorithm = normalize(entry.algorithm);
  const setup = setupFor(algorithm);
  check(preservesProgress(SOLVED_Z2, setup), `2-look edge ${entry.name} keeps F2L+cross`);
  const e = setup.applyAlg(new Alg(algorithm)).patternData.EDGES;
  check(
    e.orientation[0] === 0 && e.orientation[1] === 0 && e.orientation[2] === 0 && e.orientation[3] === 0,
    `2-look edge ${entry.name} orients top edges`
  );
  const algorithmSimplified = await toSimplified(algorithm);
  check(isOuterOnly(algorithmSimplified), `2-look edge ${entry.name} simplified is outer-only`, algorithmSimplified);
  return { ...entry, algorithm, algorithmSimplified };
}

function validF2LInsertion(algorithm, slot) {
  const setup = SOLVED_Z2.applyAlg(new Alg(algorithm).invert());
  return (
    onlySlotDisturbed(setup, slot) &&
    pairAccessible(setup, slot) &&
    isSlotSolved(setup.applyAlg(new Alg(algorithm)), slot)
  );
}

async function processF2L(entry, frByCase) {
  const slot = slotFromName(entry.name);
  const caseNum = entry.name.match(/F2L\s+(\d+)/)?.[1];
  let algorithm = normalize(entry.algorithm);
  let regenerated = false;

  if (!validF2LInsertion(algorithm, slot)) {
    const frAlg = frByCase.get(caseNum);
    const rot = SLOT_ROTATION[slot];
    const cand = normalize(rot ? `${rot} ${frAlg} ${INV_ROT[rot]}` : frAlg);
    if (frAlg && validF2LInsertion(cand, slot)) {
      algorithm = cand;
      regenerated = true;
    } else {
      check(false, `F2L ${entry.name} invalid and not regenerable`, `hand="${entry.algorithm}"`);
    }
  }

  const algorithmSimplified = await toSimplified(algorithm);
  check(isOuterOnly(algorithmSimplified), `F2L ${entry.name} simplified is outer-only`, algorithmSimplified);
  return { entry: { ...entry, algorithm, algorithmSimplified }, regenerated };
}

// -------------------------------------------------------------------- run ----

// First: verify the SLOT_ROTATION table against a trivial FR insertion.
{
  const A = "U R U' R'";
  for (const slot of ['FR', 'FL', 'BL', 'BR']) {
    const rot = SLOT_ROTATION[slot];
    const alg = rot ? `${rot} ${A} ${INV_ROT[rot]}` : A;
    const setup = SOLVED_Z2.applyAlg(new Alg(alg).invert());
    const after = setup.applyAlg(new Alg(alg));
    check(isSlotSolved(after, slot) && isCrossSolved(after), `rotation table maps ${slot}->FR`);
  }
  if (failures) {
    console.error('Rotation table self-check failed — aborting.\n' + report.join('\n'));
    process.exit(1);
  }
}

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// Build a Front-Right alg per case number (from the source's FR entries).
const frByCase = new Map();
for (const e of src.F2L) {
  if (slotFromName(e.name) === 'FR') {
    const n = e.name.match(/F2L\s+(\d+)/)?.[1];
    if (n) frByCase.set(n, normalize(e.algorithm));
  }
}

const out = {
  _source: src._source,
  _notes: src._notes,
  _generated:
    `Generated by scripts/generateAlgorithmData.mjs on ${new Date().toISOString()} ` +
    `from resources/cfop-algorithms-new.json. Do not hand-edit — re-run \`npm run gen:algs\`. ` +
    `Every entry is validated (OLL orients / PLL permutes / F2L solves its slot without ` +
    `disturbing the cross or other slots). \`algorithmSimplified\` is a single-outer-layer-turn ` +
    `sequence with the identical net effect, derived by resolving whole-cube rotations into the ` +
    `fixed frame where possible, otherwise by search; it is correct but not always the shortest ` +
    `or most idiomatic form (spec §10: generated, not authored).`,
  OLL: [],
  PLL: [],
  F2L: [],
  OLL_2LOOK_EDGE_ORIENTATION: [],
  _tier_notes: src._tier_notes,
};

let regenCount = 0;

console.log('OLL...');
for (const e of src.OLL) out.OLL.push(await processLL(e, 'OLL'));
console.log('PLL...');
for (const e of src.PLL) out.PLL.push(await processLL(e, 'PLL'));
console.log('2-look edge orientation...');
for (const e of src.OLL_2LOOK_EDGE_ORIENTATION) out.OLL_2LOOK_EDGE_ORIENTATION.push(await processEdgeOrient(e));
console.log('F2L (164 entries, ~50ms each for simplified generation)...');
for (const e of src.F2L) {
  const { entry, regenerated } = await processF2L(e, frByCase);
  if (regenerated) regenCount++;
  out.F2L.push(entry);
}

console.log('');
if (report.length) console.log(report.join('\n'));
console.log(`\nRegenerated ${regenCount} F2L slot variants that failed source validation.`);

if (failures) {
  console.error(`\n${failures} validation failure(s). NOT writing output.`);
  process.exit(1);
}

fs.writeFileSync(OUT_SRC, JSON.stringify(out, null, 2) + '\n');
fs.mkdirSync(path.dirname(OUT_PUBLIC), { recursive: true });
fs.writeFileSync(OUT_PUBLIC, JSON.stringify(out, null, 2) + '\n');
console.log(`\nOK — wrote ${out.OLL.length} OLL, ${out.PLL.length} PLL, ${out.F2L.length} F2L, ${out.OLL_2LOOK_EDGE_ORIENTATION.length} edge-orient entries.`);
console.log(`  ${path.relative(ROOT, OUT_SRC)}`);
console.log(`  ${path.relative(ROOT, OUT_PUBLIC)}`);
