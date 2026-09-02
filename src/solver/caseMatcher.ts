import type { KPuzzle, KPattern } from 'cubing/kpuzzle';
import { Alg } from 'cubing/alg';
import type { AlgorithmDataset } from '../types/solver';
import type { NotationMode } from '../types/cube';
import { parseAlgSafely, normalizeAlgString } from '../utils/algNormalizer';
import { simplifyMoveSequence } from '../utils/moveSimplifier';
import {
  F2L_SLOT_TARGETS,
  isSlotSolved as isSlotSolvedShared,
  preservesProgress,
  type F2LSlot,
} from './cfopInvariants';

export interface PrecomputedCase {
  name: string;
  subset: string;
  algorithm: string;
  algorithmSimplified: string;
  algMoves: string[];
  algSimplifiedMoves: string[];
  invertedAlg: string;
  targetPattern: KPattern;
  targetSlot?: string;
  twoLookRole?: 'corners-only' | 'edges-only' | null;
  hasRotation: boolean;
}

export interface MatchResult {
  caseName: string;
  subset: string;
  algorithm: string;
  moves: string[];
  targetSlot?: string;
}

const AUF_OPTIONS = ['', 'U', "U'", 'U2'];

export class CaseMatcher {
  private solvedPostZ2: KPattern;
  private ollCases: PrecomputedCase[] = [];
  private oll2LookCornerCases: PrecomputedCase[] = [];
  private oll2LookEdgeCases: PrecomputedCase[] = [];
  private pllCases: PrecomputedCase[] = [];
  private pll2LookCornerCases: PrecomputedCase[] = [];
  private pll2LookEdgeCases: PrecomputedCase[] = [];
  private f2lCases: PrecomputedCase[] = [];

  constructor(kp: KPuzzle) {
    this.solvedPostZ2 = kp.defaultPattern().applyAlg(new Alg('z2'));
  }

  public initialize(dataset: AlgorithmDataset): void {
    // 1. Precompute OLL cases
    this.ollCases = dataset.OLL.map((entry) => {
      const alg = parseAlgSafely(entry.algorithm);
      const inv = alg.invert();
      const targetPattern = this.solvedPostZ2.applyAlg(inv);
      const algMoves = Array.from(alg.experimentalLeafMoves()).map((m) => m.toString());

      const simplifiedStr = entry.algorithmSimplified || entry.algorithm;
      const algSimplifiedObj = parseAlgSafely(simplifiedStr);
      const algSimplifiedMoves = Array.from(algSimplifiedObj.experimentalLeafMoves()).map((m) => m.toString());

      const hasRotation = algMoves.some((m) => m.startsWith('x') || m.startsWith('y') || m.startsWith('z'));
      return {
        name: entry.name,
        subset: entry.subset || 'OLL',
        algorithm: normalizeAlgString(entry.algorithm),
        algorithmSimplified: normalizeAlgString(simplifiedStr),
        algMoves,
        algSimplifiedMoves,
        invertedAlg: inv.toString(),
        targetPattern,
        twoLookRole: entry.twoLookRole,
        hasRotation,
      };
    });

    this.oll2LookCornerCases = this.ollCases.filter((c) => c.twoLookRole === 'corners-only');

    // 2. Precompute 2-Look OLL Edge cases (Dot, Line, L-shape)
    if (dataset.OLL_2LOOK_EDGE_ORIENTATION) {
      this.oll2LookEdgeCases = dataset.OLL_2LOOK_EDGE_ORIENTATION.map((entry) => {
        const alg = parseAlgSafely(entry.algorithm);
        const inv = alg.invert();
        const targetPattern = this.solvedPostZ2.applyAlg(inv);
        const algMoves = Array.from(alg.experimentalLeafMoves()).map((m) => m.toString());

        const simplifiedStr = entry.algorithmSimplified || entry.algorithm;
        const algSimplifiedObj = parseAlgSafely(simplifiedStr);
        const algSimplifiedMoves = Array.from(algSimplifiedObj.experimentalLeafMoves()).map((m) => m.toString());

        return {
          name: `2-Look OLL · ${entry.name}`,
          subset: '2-Look OLL',
          algorithm: normalizeAlgString(entry.algorithm),
          algorithmSimplified: normalizeAlgString(simplifiedStr),
          algMoves,
          algSimplifiedMoves,
          invertedAlg: inv.toString(),
          targetPattern,
          twoLookRole: 'edges-only',
          hasRotation: false,
        };
      });
    }

    // 3. Precompute PLL cases
    this.pllCases = dataset.PLL.map((entry) => {
      const alg = parseAlgSafely(entry.algorithm);
      const inv = alg.invert();
      const targetPattern = this.solvedPostZ2.applyAlg(inv);
      const algMoves = Array.from(alg.experimentalLeafMoves()).map((m) => m.toString());

      const simplifiedStr = entry.algorithmSimplified || entry.algorithm;
      const algSimplifiedObj = parseAlgSafely(simplifiedStr);
      const algSimplifiedMoves = Array.from(algSimplifiedObj.experimentalLeafMoves()).map((m) => m.toString());

      const hasRotation = algMoves.some((m) => m.startsWith('x') || m.startsWith('y') || m.startsWith('z'));
      return {
        name: entry.name,
        subset: entry.subset || 'PLL',
        algorithm: normalizeAlgString(entry.algorithm),
        algorithmSimplified: normalizeAlgString(simplifiedStr),
        algMoves,
        algSimplifiedMoves,
        invertedAlg: inv.toString(),
        targetPattern,
        twoLookRole: entry.twoLookRole,
        hasRotation,
      };
    });

    this.pll2LookCornerCases = this.pllCases.filter((c) => c.twoLookRole === 'corners-only');
    this.pll2LookEdgeCases = this.pllCases.filter((c) => c.twoLookRole === 'edges-only');

    // 4. Precompute F2L cases
    this.f2lCases = dataset.F2L.map((entry) => {
      const alg = parseAlgSafely(entry.algorithm);
      const inv = alg.invert();
      const targetPattern = this.solvedPostZ2.applyAlg(inv);
      const algMoves = Array.from(alg.experimentalLeafMoves()).map((m) => m.toString());

      const simplifiedStr = entry.algorithmSimplified || entry.algorithm;
      const algSimplifiedObj = parseAlgSafely(simplifiedStr);
      const algSimplifiedMoves = Array.from(algSimplifiedObj.experimentalLeafMoves()).map((m) => m.toString());

      const hasRotation = algMoves.some((m) => m.startsWith('x') || m.startsWith('y') || m.startsWith('z'));

      let targetSlot = 'FR';
      if (entry.name.includes('Front Left')) targetSlot = 'FL';
      else if (entry.name.includes('Back Right')) targetSlot = 'BR';
      else if (entry.name.includes('Back Left')) targetSlot = 'BL';

      return {
        name: entry.name,
        subset: entry.subset || 'F2L',
        algorithm: normalizeAlgString(entry.algorithm),
        algorithmSimplified: normalizeAlgString(simplifiedStr),
        algMoves,
        algSimplifiedMoves,
        invertedAlg: inv.toString(),
        targetPattern,
        targetSlot,
        hasRotation,
      };
    });
  }

  /**
   * Matches OLL case (1-Look, all 57 cases) by checking top-layer orientations under AUF setup turns.
   */
  public matchOLL(livePattern: KPattern, notationMode: NotationMode = 'simplified'): MatchResult | null {
    const liveEdges = livePattern.patternData.EDGES;
    const liveCorners = livePattern.patternData.CORNERS;

    const isAlreadyOriented =
      liveEdges.orientation[0] === 0 &&
      liveEdges.orientation[1] === 0 &&
      liveEdges.orientation[2] === 0 &&
      liveEdges.orientation[3] === 0 &&
      liveCorners.orientation[0] === 0 &&
      liveCorners.orientation[1] === 0 &&
      liveCorners.orientation[2] === 0 &&
      liveCorners.orientation[3] === 0;

    if (isAlreadyOriented) {
      return {
        caseName: 'OLL Skip (Oriented)',
        subset: 'Solved',
        algorithm: '',
        moves: [],
      };
    }

    for (const auf of AUF_OPTIONS) {
      const patternToTest = auf ? livePattern.applyAlg(new Alg(auf)) : livePattern;
      const testE = patternToTest.patternData.EDGES;
      const testC = patternToTest.patternData.CORNERS;

      for (const c of this.ollCases) {
        const targetE = c.targetPattern.patternData.EDGES;
        const targetC = c.targetPattern.patternData.CORNERS;

        const edgesMatch =
          testE.orientation[0] === targetE.orientation[0] &&
          testE.orientation[1] === targetE.orientation[1] &&
          testE.orientation[2] === targetE.orientation[2] &&
          testE.orientation[3] === targetE.orientation[3];

        const cornersMatch =
          testC.orientation[0] === targetC.orientation[0] &&
          testC.orientation[1] === targetC.orientation[1] &&
          testC.orientation[2] === targetC.orientation[2] &&
          testC.orientation[3] === targetC.orientation[3];

        if (edgesMatch && cornersMatch) {
          const selectedMoves = notationMode === 'simplified' ? c.algSimplifiedMoves : c.algMoves;
          const selectedAlg = notationMode === 'simplified' ? c.algorithmSimplified : c.algorithm;
          const rawMoves = auf ? [auf, ...selectedMoves] : [...selectedMoves];
          return {
            caseName: c.name,
            subset: c.subset,
            algorithm: selectedAlg,
            moves: simplifyMoveSequence(rawMoves),
          };
        }
      }
    }

    return null;
  }

  /**
   * Matches PLL case (1-Look, all 21 cases) by checking top-layer permutation under pre-AUF and post-AUF turns.
   */
  public matchPLL(livePattern: KPattern, notationMode: NotationMode = 'simplified'): MatchResult | null {
    const targetE = this.solvedPostZ2.patternData.EDGES;
    const targetC = this.solvedPostZ2.patternData.CORNERS;

    for (const auf of AUF_OPTIONS) {
      const testPattern = auf ? livePattern.applyAlg(new Alg(auf)) : livePattern;
      const e = testPattern.patternData.EDGES;
      const c = testPattern.patternData.CORNERS;

      const isSolved =
        e.pieces.every((p, i) => p === targetE.pieces[i]) &&
        c.pieces.every((p, i) => p === targetC.pieces[i]);

      if (isSolved) {
        return {
          caseName: auf ? `AUF (${auf})` : 'PLL Skip (Solved)',
          subset: 'Solved',
          algorithm: auf,
          moves: auf ? [auf] : [],
        };
      }
    }

    for (const preAuf of AUF_OPTIONS) {
      const patternAfterPre = preAuf ? livePattern.applyAlg(new Alg(preAuf)) : livePattern;

      for (const pll of this.pllCases) {
        const afterAlgPattern = patternAfterPre.applyAlg(parseAlgSafely(pll.algorithm));

        for (const postAuf of AUF_OPTIONS) {
          const finalPattern = postAuf ? afterAlgPattern.applyAlg(new Alg(postAuf)) : afterAlgPattern;
          const fe = finalPattern.patternData.EDGES;
          const fc = finalPattern.patternData.CORNERS;

          const isComplete =
            fe.pieces.every((p, i) => p === targetE.pieces[i]) &&
            fc.pieces.every((p, i) => p === targetC.pieces[i]);

          if (isComplete) {
            const selectedMoves = notationMode === 'simplified' ? pll.algSimplifiedMoves : pll.algMoves;
            const selectedAlg = notationMode === 'simplified' ? pll.algorithmSimplified : pll.algorithm;
            const rawMoves: string[] = [];
            if (preAuf) rawMoves.push(preAuf);
            rawMoves.push(...selectedMoves);
            if (postAuf) rawMoves.push(postAuf);

            return {
              caseName: pll.name,
              subset: pll.subset,
              algorithm: selectedAlg,
              moves: simplifyMoveSequence(rawMoves),
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Matches 2-Look OLL (Tier 1 Basic & Tier 2 Confident):
   * Step (a): Orient edges into a cross using Dot / Line / L-shape (3 algorithms).
   * Step (b): Orient corners using exactly the 7 cases tagged `twoLookRole: "corners-only"` (Sune, Anti-Sune, H, Pi, U, T, L).
   * Strictly 10 algorithms total.
   */
  public match2LookOLL(livePattern: KPattern, notationMode: NotationMode = 'simplified'): MatchResult | null {
    const liveEdges = livePattern.patternData.EDGES;
    const liveCorners = livePattern.patternData.CORNERS;

    const areEdgesOriented =
      liveEdges.orientation[0] === 0 &&
      liveEdges.orientation[1] === 0 &&
      liveEdges.orientation[2] === 0 &&
      liveEdges.orientation[3] === 0;

    const areCornersOriented =
      liveCorners.orientation[0] === 0 &&
      liveCorners.orientation[1] === 0 &&
      liveCorners.orientation[2] === 0 &&
      liveCorners.orientation[3] === 0;

    if (areEdgesOriented && areCornersOriented) {
      return {
        caseName: 'OLL Complete',
        subset: 'Solved',
        algorithm: '',
        moves: [],
      };
    }

    if (!areEdgesOriented) {
      const edgeAlgs = this.oll2LookEdgeCases.length > 0
        ? this.oll2LookEdgeCases
        : [
            { name: '2-Look OLL · Yellow Cross (Line)', algorithm: "F R U R' U' F'", algorithmSimplified: "F R U R' U' F'", algMoves: ['F', 'R', 'U', "R'", "U'", "F'"], algSimplifiedMoves: ['F', 'R', 'U', "R'", "U'", "F'"], subset: '2-Look OLL' },
            { name: '2-Look OLL · Yellow Cross (L-Shape)', algorithm: "f R U R' U' f'", algorithmSimplified: "F U R U' R' F'", algMoves: ['f', 'R', 'U', "R'", "U'", "f'"], algSimplifiedMoves: ['F', 'U', 'R', "U'", "R'", "F'"], subset: '2-Look OLL' },
            { name: '2-Look OLL · Yellow Cross (Dot)', algorithm: "F (R U R' U') F' f (R U R' U') f'", algorithmSimplified: "F R U R' U' F' U2 F U R U' R' F'", algMoves: ['F', 'R', 'U', "R'", "U'", "F'", 'f', 'R', 'U', "R'", "U'", "f'"], algSimplifiedMoves: ['F', 'R', 'U', "R'", "U'", "F'", 'U2', 'F', 'U', 'R', "U'", "R'", "F'"], subset: '2-Look OLL' },
          ];

      for (const auf of AUF_OPTIONS) {
        const patternToTest = auf ? livePattern.applyAlg(new Alg(auf)) : livePattern;

        for (const entry of edgeAlgs) {
          const res = patternToTest.applyAlg(parseAlgSafely(entry.algorithm));
          const re = res.patternData.EDGES;
          if (re.orientation[0] === 0 && re.orientation[1] === 0 && re.orientation[2] === 0 && re.orientation[3] === 0) {
            const selectedMoves = notationMode === 'simplified' ? entry.algSimplifiedMoves : entry.algMoves;
            const selectedAlg = notationMode === 'simplified' ? entry.algorithmSimplified : entry.algorithm;
            const rawMoves = auf ? [auf, ...selectedMoves] : [...selectedMoves];
            return {
              caseName: entry.name,
              subset: '2-Look OLL',
              algorithm: selectedAlg,
              moves: simplifyMoveSequence(rawMoves),
            };
          }
        }
      }

      const fallbackMoves = notationMode === 'simplified' ? ['F', 'R', 'U', "R'", "U'", "F'"] : ['F', 'R', 'U', "R'", "U'", "F'"];
      return {
        caseName: '2-Look OLL · Yellow Cross (F R U R\' U\' F\')',
        subset: '2-Look OLL',
        algorithm: "F R U R' U' F'",
        moves: fallbackMoves,
      };
    }

    const cornerCandidates = this.oll2LookCornerCases.length > 0
      ? this.oll2LookCornerCases
      : this.ollCases.filter((c) =>
          c.name.includes('Sune') ||
          c.name.includes('H') ||
          c.name.includes('Pi') ||
          c.name.includes('Headlights') ||
          c.name.includes('T') ||
          c.name.includes('Bowtie')
        );

    for (const auf of AUF_OPTIONS) {
      const patternToTest = auf ? livePattern.applyAlg(new Alg(auf)) : livePattern;
      const testC = patternToTest.patternData.CORNERS;

      for (const c of cornerCandidates) {
        const targetC = c.targetPattern.patternData.CORNERS;
        const cornersMatch =
          testC.orientation[0] === targetC.orientation[0] &&
          testC.orientation[1] === targetC.orientation[1] &&
          testC.orientation[2] === targetC.orientation[2] &&
          testC.orientation[3] === targetC.orientation[3];

        if (cornersMatch) {
          const selectedMoves = notationMode === 'simplified' ? c.algSimplifiedMoves : c.algMoves;
          const selectedAlg = notationMode === 'simplified' ? c.algorithmSimplified : c.algorithm;
          const rawMoves = auf ? [auf, ...selectedMoves] : [...selectedMoves];
          return {
            caseName: `2-Look OLL · ${c.name}`,
            subset: '2-Look OLL',
            algorithm: selectedAlg,
            moves: simplifyMoveSequence(rawMoves),
          };
        }
      }
    }

    return {
      caseName: '2-Look OLL · Orient Corners (Sune)',
      subset: '2-Look OLL',
      algorithm: "R U R' U R U2 R'",
      moves: ['R', 'U', "R'", 'U', 'R', 'U2', "R'"],
    };
  }

  /**
   * Matches 2-Look PLL (Tier 1 Basic):
   * Step (a): Permute corners using Aa Perm / Ab Perm ONLY (2 algorithms).
   * Step (b): Permute edges using Ua Perm / Ub Perm / H Perm / Z Perm ONLY (4 algorithms).
   * Strictly 6 algorithms total. No T-Perm, Y-Perm, or 1-Look PLLs may appear here.
   */
  public match2LookPLL(livePattern: KPattern, notationMode: NotationMode = 'simplified'): MatchResult | null {
    const targetC = this.solvedPostZ2.patternData.CORNERS;
    const targetE = this.solvedPostZ2.patternData.EDGES;

    for (const auf of AUF_OPTIONS) {
      const testPattern = auf ? livePattern.applyAlg(new Alg(auf)) : livePattern;
      const e = testPattern.patternData.EDGES;
      const c = testPattern.patternData.CORNERS;

      if (e.pieces.every((p, i) => p === targetE.pieces[i]) && c.pieces.every((p, i) => p === targetC.pieces[i])) {
        return {
          caseName: auf ? `AUF (${auf})` : 'PLL Skip (Solved)',
          subset: 'Solved',
          algorithm: auf,
          moves: auf ? [auf] : [],
        };
      }
    }

    let areCornersPermuted = false;
    for (const auf of AUF_OPTIONS) {
      const testPattern = auf ? livePattern.applyAlg(new Alg(auf)) : livePattern;
      const c = testPattern.patternData.CORNERS;
      if (c.pieces.every((p, i) => p === targetC.pieces[i])) {
        areCornersPermuted = true;
        break;
      }
    }

    const cornerCandidates = this.pll2LookCornerCases.length > 0
      ? this.pll2LookCornerCases
      : [
          { name: 'Aa Perm', algorithm: "x (R' U R') D2 (R U' R') D2 R2 x'", algorithmSimplified: "R' F R' B2 R F' R' B2 R2", algMoves: ['x', "R'", 'U', "R'", 'D2', 'R', "U'", "R'", 'D2', 'R2', "x'"], algSimplifiedMoves: ["R'", 'F', "R'", 'B2', 'R', "F'", "R'", 'B2', 'R2'] },
          { name: 'Ab Perm', algorithm: "x R2 D2 (R U R') D2 (R U' R) x'", algorithmSimplified: "R2 B2 R F R' B2 R F' R", algMoves: ['x', 'R2', 'D2', 'R', 'U', "R'", 'D2', 'R', "U'", 'R', "x'"], algSimplifiedMoves: ['R2', 'B2', 'R', 'F', "R'", 'B2', 'R', "F'", 'R'] },
        ];

    if (!areCornersPermuted) {
      for (const preAuf of AUF_OPTIONS) {
        const testPattern = preAuf ? livePattern.applyAlg(new Alg(preAuf)) : livePattern;

        for (const entry of cornerCandidates) {
          const afterAlg = testPattern.applyAlg(parseAlgSafely(entry.algorithm));

          for (const postAuf of AUF_OPTIONS) {
            const finalPattern = postAuf ? afterAlg.applyAlg(new Alg(postAuf)) : afterAlg;
            const fc = finalPattern.patternData.CORNERS;

            if (fc.pieces.every((p, i) => p === targetC.pieces[i])) {
              const selectedMoves = notationMode === 'simplified' ? entry.algSimplifiedMoves : entry.algMoves;
              const selectedAlg = notationMode === 'simplified' ? entry.algorithmSimplified : entry.algorithm;
              const rawMoves: string[] = [];
              if (preAuf) rawMoves.push(preAuf);
              rawMoves.push(...selectedMoves);
              if (postAuf) rawMoves.push(postAuf);

              return {
                caseName: `2-Look PLL · Step 1: Corners (${entry.name})`,
                subset: '2-Look PLL',
                algorithm: selectedAlg,
                moves: simplifyMoveSequence(rawMoves),
              };
            }
          }
        }
      }

      const defaultCorner = cornerCandidates[0];
      const selectedMoves = notationMode === 'simplified' ? defaultCorner.algSimplifiedMoves : defaultCorner.algMoves;
      const selectedAlg = notationMode === 'simplified' ? defaultCorner.algorithmSimplified : defaultCorner.algorithm;
      return {
        caseName: `2-Look PLL · Step 1: Corners (${defaultCorner.name})`,
        subset: '2-Look PLL',
        algorithm: selectedAlg,
        moves: simplifyMoveSequence([...selectedMoves]),
      };
    }

    const edgeCandidates = this.pll2LookEdgeCases.length > 0
      ? this.pll2LookEdgeCases
      : [
          { name: 'Ua Perm', algorithm: "(R U R' U R') U' R2 U' (R' U R' U R)", algorithmSimplified: "(R U R' U R') U' R2 U' (R' U R' U R)", algMoves: ['R', 'U', "R'", 'U', "R'", "U'", 'R2', "U'", "R'", 'U', "R'", 'U', 'R'], algSimplifiedMoves: ['R', 'U', "R'", 'U', "R'", "U'", 'R2', "U'", "R'", 'U', "R'", 'U', 'R'] },
          { name: 'Ub Perm', algorithm: "(R' U) (R' U') (R' U') (R' U) R U R2", algorithmSimplified: "(R' U) (R' U') (R' U') (R' U) R U R2", algMoves: ["R'", 'U', "R'", "U'", "R'", "U'", "R'", 'U', 'R', 'U', 'R2'], algSimplifiedMoves: ["R'", 'U', "R'", "U'", "R'", "U'", "R'", 'U', 'R', 'U', 'R2'] },
          { name: 'H Perm', algorithm: "M2 (U') M2 (U2') M2 (U') M2", algorithmSimplified: "R2 U2 R U2 R2 U2 R2 U2 R U2 R2", algMoves: ['M2', "U'", 'M2', "U2'", 'M2', "U'", 'M2'], algSimplifiedMoves: ['R2', 'U2', 'R', 'U2', 'R2', 'U2', 'R2', 'U2', 'R', 'U2', 'R2'] },
          { name: 'Z Perm', algorithm: "M' U' (M2' U') (M2' U') M' U2' M2'", algorithmSimplified: "R' U' R2 U R U R' U' R U R U' R U' R'", algMoves: ["M'", "U'", "M2'", "U'", "M2'", "U'", "M'", "U2'", "M2'"], algSimplifiedMoves: ["R'", "U'", 'R2', 'U', 'R', 'U', "R'", "U'", 'R', 'U', 'R', "U'", 'R', "U'", "R'"] },
        ];

    for (const preAuf of AUF_OPTIONS) {
      const patternAfterPre = preAuf ? livePattern.applyAlg(new Alg(preAuf)) : livePattern;

      for (const entry of edgeCandidates) {
        const afterAlgPattern = patternAfterPre.applyAlg(parseAlgSafely(entry.algorithm));

        for (const postAuf of AUF_OPTIONS) {
          const finalPattern = postAuf ? afterAlgPattern.applyAlg(new Alg(postAuf)) : afterAlgPattern;
          const fe = finalPattern.patternData.EDGES;
          const fc = finalPattern.patternData.CORNERS;

          if (fe.pieces.every((p, i) => p === targetE.pieces[i]) && fc.pieces.every((p, i) => p === targetC.pieces[i])) {
            const selectedMoves = notationMode === 'simplified' ? entry.algSimplifiedMoves : entry.algMoves;
            const selectedAlg = notationMode === 'simplified' ? entry.algorithmSimplified : entry.algorithm;
            const rawMoves: string[] = [];
            if (preAuf) rawMoves.push(preAuf);
            rawMoves.push(...selectedMoves);
            if (postAuf) rawMoves.push(postAuf);

            return {
              caseName: `2-Look PLL · Step 2: Edges (${entry.name})`,
              subset: '2-Look PLL',
              algorithm: selectedAlg,
              moves: simplifyMoveSequence(rawMoves),
            };
          }
        }
      }
    }

    const defaultEdge = edgeCandidates[0];
    const selectedMoves = notationMode === 'simplified' ? defaultEdge.algSimplifiedMoves : defaultEdge.algMoves;
    const selectedAlg = notationMode === 'simplified' ? defaultEdge.algorithmSimplified : defaultEdge.algorithm;
    return {
      caseName: `2-Look PLL · Step 2: Edges (${defaultEdge.name})`,
      subset: '2-Look PLL',
      algorithm: selectedAlg,
      moves: simplifyMoveSequence([...selectedMoves]),
    };
  }

  public matchF2L(
    livePattern: KPattern,
    preferredSlot?: string,
    preferRotationless = false,
    notationMode: NotationMode = 'simplified'
  ): MatchResult | null {
    // Only ever solve the requested slot. Never fall back to "any slot" — a
    // sequence that happens to leave some *already-solved* slot solved is a
    // no-op for the slot we actually need and makes the guided walkthrough loop.
    const slot = (preferredSlot || 'FR') as F2LSlot;
    const candidates = this.f2lCases.filter((c) => c.targetSlot === slot);

    if (preferRotationless) {
      candidates.sort((a, b) => (a.hasRotation === b.hasRotation ? 0 : a.hasRotation ? 1 : -1));
    }

    for (const auf of AUF_OPTIONS) {
      const patternToTest = auf ? livePattern.applyAlg(new Alg(auf)) : livePattern;

      for (const c of candidates) {
        const resultPattern = patternToTest.applyAlg(parseAlgSafely(c.algorithm));
        if (
          isSlotSolvedShared(resultPattern, slot) &&
          preservesProgress(livePattern, resultPattern)
        ) {
          const selectedMoves = notationMode === 'simplified' ? c.algSimplifiedMoves : c.algMoves;
          const selectedAlg = notationMode === 'simplified' ? c.algorithmSimplified : c.algorithm;
          const rawMoves = auf ? [auf, ...selectedMoves] : [...selectedMoves];

          return {
            caseName: c.name,
            subset: c.subset,
            algorithm: selectedAlg,
            moves: simplifyMoveSequence(rawMoves),
            targetSlot: c.targetSlot,
          };
        }
      }
    }

    return null;
  }

  /**
   * Matches Pure Intuitive F2L:

   * Uses 100% outer-layer moves (R, L, U, F, B) and NO wide moves (f, r, l, d, b) or slice moves (M, S, E).
   * Automatically simplifies any consecutive same-face moves.
   */
  public matchIntuitiveF2L(livePattern: KPattern, preferredSlot?: string): MatchResult | null {
    // Pure outer-face intuitive insertions and pair solutions
    const intuitiveLibrary = [
      // 1. Front-Right (FR) Slot
      { name: "Intuitive F2L · Right Insertion (U R U' R')", alg: "U R U' R'", slot: 'FR' },
      { name: "Intuitive F2L · Right Insertion (R U' R')", alg: "R U' R'", slot: 'FR' },
      { name: "Intuitive F2L · Sexy Insertion (R U R')", alg: "R U R'", slot: 'FR' },
      { name: "Intuitive F2L · Front Insertion (F' U' F)", alg: "F' U' F", slot: 'FR' },
      { name: "Intuitive F2L · Sledgehammer (R' F R F')", alg: "R' F R F'", slot: 'FR' },
      { name: "Intuitive F2L · Pair & Insert (R U2 R' U R U' R')", alg: "R U2 R' U R U' R'", slot: 'FR' },
      { name: "Intuitive F2L · Pair & Insert (U' R U2 R' U2 R U' R')", alg: "U' R U2 R' U2 R U' R'", slot: 'FR' },
      { name: "Intuitive F2L · Pair & Insert (U R U2 R' U R U' R')", alg: "U R U2 R' U R U' R'", slot: 'FR' },
      { name: "Intuitive F2L · Separate & Insert (R U' R' U2 R U' R')", alg: "R U' R' U2 R U' R'", slot: 'FR' },
      { name: "Intuitive F2L · Extract & Insert (R U R' U' R U R')", alg: "R U R' U' R U R'", slot: 'FR' },
      { name: "Intuitive F2L · White Facing Up (U' R U' R' U R U R')", alg: "U' R U' R' U R U R'", slot: 'FR' },
      { name: "Intuitive F2L · White Facing Up (R U2 R' U' R U R')", alg: "R U2 R' U' R U R'", slot: 'FR' },

      // 2. Front-Left (FL) Slot
      { name: "Intuitive F2L · Left Insertion (U' L' U L)", alg: "U' L' U L", slot: 'FL' },
      { name: "Intuitive F2L · Left Insertion (L' U L)", alg: "L' U L", slot: 'FL' },
      { name: "Intuitive F2L · Left Insertion (L' U' L)", alg: "L' U' L", slot: 'FL' },
      { name: "Intuitive F2L · Front Insertion (F U F')", alg: "F U F'", slot: 'FL' },
      { name: "Intuitive F2L · Sledgehammer (L F' L' F)", alg: "L F' L' F", slot: 'FL' },
      { name: "Intuitive F2L · Pair & Insert (L' U2 L U' L' U L)", alg: "L' U2 L U' L' U L", slot: 'FL' },
      { name: "Intuitive F2L · Pair & Insert (U L' U2 L U2 L' U L)", alg: "U L' U2 L U2 L' U L", slot: 'FL' },
      { name: "Intuitive F2L · Pair & Insert (U' L' U2 L U' L' U L)", alg: "U' L' U2 L U' L' U L", slot: 'FL' },
      { name: "Intuitive F2L · Separate & Insert (L' U L U2 L' U L)", alg: "L' U L U2 L' U L", slot: 'FL' },
      { name: "Intuitive F2L · Extract & Insert (L' U' L U L' U' L)", alg: "L' U' L U L' U' L", slot: 'FL' },
      { name: "Intuitive F2L · White Facing Up (U L' U L U' L' U' L)", alg: "U L' U L U' L' U' L", slot: 'FL' },
      { name: "Intuitive F2L · White Facing Up (L' U2 L U L' U' L)", alg: "L' U2 L U L' U' L", slot: 'FL' },

      // 3. Back-Right (BR) Slot (Clean outer-layer moves, NO wide f moves)
      { name: "Intuitive F2L · Back Right (U' R' U R)", alg: "U' R' U R", slot: 'BR' },
      { name: "Intuitive F2L · Back Right (R' U R)", alg: "R' U R", slot: 'BR' },
      { name: "Intuitive F2L · Back Right (R' U' R)", alg: "R' U' R", slot: 'BR' },
      { name: "Intuitive F2L · Back Right (B U B')", alg: "B U B'", slot: 'BR' },
      { name: "Intuitive F2L · Back Right (R' U2 R U' R' U R)", alg: "R' U2 R U' R' U R", slot: 'BR' },
      { name: "Intuitive F2L · Back Right (U' R' U2 R U2 R' U R)", alg: "U' R' U2 R U2 R' U R", slot: 'BR' },
      { name: "Intuitive F2L · Back Right (U R' U2 R U' R' U R)", alg: "U R' U2 R U' R' U R", slot: 'BR' },
      { name: "Intuitive F2L · Back Right (R' U R U2 R' U R)", alg: "R' U R U2 R' U R", slot: 'BR' },
      { name: "Intuitive F2L · Back Right (R' U' R U R' U' R)", alg: "R' U' R U R' U' R", slot: 'BR' },
      { name: "Intuitive F2L · Back Right (R' U2 R U R' U' R)", alg: "R' U2 R U R' U' R", slot: 'BR' },

      // 4. Back-Left (BL) Slot (Clean outer-layer moves, NO wide f moves)
      { name: "Intuitive F2L · Back Left (U L U' L')", alg: "U L U' L'", slot: 'BL' },
      { name: "Intuitive F2L · Back Left (L U' L')", alg: "L U' L'", slot: 'BL' },
      { name: "Intuitive F2L · Back Left (L U L')", alg: "L U L'", slot: 'BL' },
      { name: "Intuitive F2L · Back Left (B' U' B)", alg: "B' U' B", slot: 'BL' },
      { name: "Intuitive F2L · Back Left (L U2 L' U L U' L')", alg: "L U2 L' U L U' L'", slot: 'BL' },
      { name: "Intuitive F2L · Back Left (U L U2 L' U2 L U' L')", alg: "U L U2 L' U2 L U' L'", slot: 'BL' },
      { name: "Intuitive F2L · Back Left (U' L U2 L' U L U' L')", alg: "U' L U2 L' U L U' L'", slot: 'BL' },
      { name: "Intuitive F2L · Back Left (L U' L' U2 L U' L')", alg: "L U' L' U2 L U' L'", slot: 'BL' },
      { name: "Intuitive F2L · Back Left (L U L' U' L U L')", alg: "L U L' U' L U L'", slot: 'BL' },
      { name: "Intuitive F2L · Back Left (L U2 L' U' L U L')", alg: "L U2 L' U' L U L'", slot: 'BL' },
    ];

    for (const auf of AUF_OPTIONS) {
      const patternToTest = auf ? livePattern.applyAlg(new Alg(auf)) : livePattern;

      for (const entry of intuitiveLibrary) {
        if (preferredSlot && entry.slot !== preferredSlot) continue;
        const res = patternToTest.applyAlg(parseAlgSafely(entry.alg));
        if (isSlotSolvedShared(res, entry.slot as F2LSlot) && preservesProgress(livePattern, res)) {
          const algObj = parseAlgSafely(entry.alg);
          const algMoves = Array.from(algObj.experimentalLeafMoves()).map((m) => m.toString());
          const rawMoves = auf ? [auf, ...algMoves] : algMoves;
          return {
            caseName: entry.name,
            subset: 'Intuitive F2L',
            algorithm: entry.alg,
            moves: simplifyMoveSequence(rawMoves),
            targetSlot: entry.slot,
          };
        }
      }
    }

    // 2. Fallback: Search pure outer-layer cases from dataset (strict filter: no wide/slice moves)
    const pureCandidates = this.f2lCases.filter(
      (c) =>
        (!preferredSlot || c.targetSlot === preferredSlot) &&
        !/[frludbMSE]/.test(c.algorithm)
    );

    for (const auf of AUF_OPTIONS) {
      const patternToTest = auf ? livePattern.applyAlg(new Alg(auf)) : livePattern;

      for (const c of pureCandidates) {
        const res = patternToTest.applyAlg(parseAlgSafely(c.algorithm));
        if (
          isSlotSolvedShared(res, (c.targetSlot || 'FR') as F2LSlot) &&
          preservesProgress(livePattern, res)
        ) {
          const rawMoves = auf ? [auf, ...c.algMoves] : [...c.algMoves];
          return {
            caseName: `Intuitive F2L · Pair & Insert (${c.targetSlot || 'Slot'})`,
            subset: 'Intuitive F2L',
            algorithm: c.algorithm,
            moves: simplifyMoveSequence(rawMoves),
            targetSlot: c.targetSlot,
          };
        }
      }
    }

    // 3. Multi-Step Intuitive Solver: Extract trapped pieces from the EXACT slot where they are physically stuck
    const extractionTriggers: Record<string, string[]> = {
      FR: ["R U R'", "R U' R'", "R U2 R'", "F' U' F", "F' U F"],
      FL: ["L' U' L", "L' U L", "L' U2 L", "F U F'", "F U' F'"],
      BR: ["R' U' R", "R' U R", "R' U2 R", "B U B'", "B U' B'"],
      BL: ["L U L'", "L U' L'", "L U2 L'", "B' U' B", "B' U B"],
    };

    const slotsToTry = preferredSlot ? [preferredSlot] : ['FR', 'FL', 'BR', 'BL'];

    for (const slot of slotsToTry) {
      const t = F2L_SLOT_TARGETS[slot as F2LSlot];
      if (!t) continue;

      // Locate where this slot's corner and edge pieces are physically trapped
      const cornerLocation = this.getSlotForPiece(t.cornerPiece, true, livePattern);
      const edgeLocation = this.getSlotForPiece(t.edgePiece, false, livePattern);

      const slotsToExtractFrom = new Set<string>();
      if (cornerLocation !== 'U') slotsToExtractFrom.add(cornerLocation);
      if (edgeLocation !== 'U') slotsToExtractFrom.add(edgeLocation);
      slotsToExtractFrom.add(slot); // Also try the target slot itself

      for (const extractSlot of slotsToExtractFrom) {
        const extractions = extractionTriggers[extractSlot] || extractionTriggers.FR;

        for (const extractAlg of extractions) {
          const extractAlgObj = parseAlgSafely(extractAlg);
          const patternAfterExtract = livePattern.applyAlg(extractAlgObj);

          // Check if any intuitive library algorithm solves the slot after extraction
          for (const auf of AUF_OPTIONS) {
            const patternToTest = auf ? patternAfterExtract.applyAlg(new Alg(auf)) : patternAfterExtract;

            for (const entry of intuitiveLibrary) {
              if (entry.slot !== slot) continue;
              const res = patternToTest.applyAlg(parseAlgSafely(entry.alg));

              if (isSlotSolvedShared(res, slot as F2LSlot) && preservesProgress(livePattern, res)) {
                const extractMoves = Array.from(extractAlgObj.experimentalLeafMoves()).map((m) => m.toString());
                const entryAlgObj = parseAlgSafely(entry.alg);
                const entryMoves = Array.from(entryAlgObj.experimentalLeafMoves()).map((m) => m.toString());
                const combinedMoves = auf
                  ? [...extractMoves, auf, ...entryMoves]
                  : [...extractMoves, ...entryMoves];

                const desc = extractSlot === slot
                  ? `Intuitive F2L · Extract & Insert (${slot} Slot)`
                  : `Intuitive F2L · Extract from ${extractSlot} & Insert into ${slot}`;

                return {
                  caseName: desc,
                  subset: 'Intuitive F2L',
                  algorithm: `${extractAlg} ${auf ? auf + ' ' : ''}${entry.alg}`,
                  moves: simplifyMoveSequence(combinedMoves),
                  targetSlot: slot,
                };
              }
            }
          }
        }
      }

      // If multi-step combine didn't find direct completion, return the primary extraction move
      const trapSlot = edgeLocation !== 'U' && edgeLocation !== slot
        ? edgeLocation
        : cornerLocation !== 'U' && cornerLocation !== slot
        ? cornerLocation
        : slot;

      const defaultExtraction = extractionTriggers[trapSlot]?.[0] || "R U R'";
      const extractAlgObj = parseAlgSafely(defaultExtraction);
      const extractMoves = Array.from(extractAlgObj.experimentalLeafMoves()).map((m) => m.toString());

      return {
        caseName: `Intuitive F2L · Extract piece from ${trapSlot} slot (${defaultExtraction})`,
        subset: 'Intuitive F2L',
        algorithm: defaultExtraction,
        moves: simplifyMoveSequence(extractMoves),
        targetSlot: slot,
      };
    }

    return null;
  }

  /** Solved cube in the app's post-z2 reference frame (centers not solved, LL orientations are). */
  public getSolvedPostZ2(): KPattern {
    return this.solvedPostZ2;
  }

  /** Precomputed case list for a training phase — used by Training mode's scramble generator + UI filter. */
  public getCases(phase: 'OLL' | 'PLL' | 'F2L'): PrecomputedCase[] {
    if (phase === 'OLL') return this.ollCases;
    if (phase === 'PLL') return this.pllCases;
    return this.f2lCases;
  }

  /** The 3 2-Look OLL edge-orientation cases (Dot / Line / L-shape), for the yellow-cross drill. */
  public getTwoLookEdgeCases(): PrecomputedCase[] {
    return this.oll2LookEdgeCases;
  }

  private getSlotForPiece(piece: number, isCorner: boolean, pattern: KPattern): string | 'U' {
    const arr = isCorner ? pattern.patternData.CORNERS.pieces : pattern.patternData.EDGES.pieces;
    const at = arr.indexOf(piece);
    if (at >= 0 && at <= 3) return 'U';
    for (const slot of ['FR', 'FL', 'BR', 'BL'] as F2LSlot[]) {
      const t = F2L_SLOT_TARGETS[slot];
      if (at === (isCorner ? t.cornerSlot : t.edgeSlot)) return slot;
    }
    return 'U';
  }

}



