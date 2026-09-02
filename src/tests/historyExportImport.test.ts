import { describe, it, expect } from 'vitest';
import {
  parseTimeString,
  parseCSVLine,
  parseHistoryImport,
  filterSolvesForImport,
} from '../utils/historyExportImport';
import type { Solve, PhaseSplit } from '../types/db';

describe('History Export & Import Utilities', () => {
  describe('parseTimeString', () => {
    it('parses standard second formats', () => {
      expect(parseTimeString('12.34')).toEqual({ timeMs: 12340, dnf: false, plusTwo: false });
      expect(parseTimeString('9.05')).toEqual({ timeMs: 9050, dnf: false, plusTwo: false });
      expect(parseTimeString('0.58')).toEqual({ timeMs: 580, dnf: false, plusTwo: false });
    });

    it('parses minute:second formats', () => {
      expect(parseTimeString('1:05.42')).toEqual({ timeMs: 65420, dnf: false, plusTwo: false });
      expect(parseTimeString('2:10.00')).toEqual({ timeMs: 130000, dnf: false, plusTwo: false });
    });

    it('parses hour:minute:second formats', () => {
      expect(parseTimeString('1:02:03.45')).toEqual({ timeMs: 3723450, dnf: false, plusTwo: false });
    });

    it('parses DNF with and without inner time', () => {
      expect(parseTimeString('DNF(12.34)')).toEqual({ timeMs: 12340, dnf: true, plusTwo: false });
      expect(parseTimeString('dnf(1:05.20)')).toEqual({ timeMs: 65200, dnf: true, plusTwo: false });
      expect(parseTimeString('DNF')).toEqual({ timeMs: 0, dnf: true, plusTwo: false });
    });

    it('parses +2 penalty suffix', () => {
      expect(parseTimeString('14.50+')).toEqual({ timeMs: 14500, dnf: false, plusTwo: true });
      expect(parseTimeString('14.50(+2)')).toEqual({ timeMs: 14500, dnf: false, plusTwo: true });
    });
  });

  describe('parseCSVLine', () => {
    it('parses standard comma-separated cells', () => {
      expect(parseCSVLine('1,12.34,OK,12340')).toEqual(['1', '12.34', 'OK', '12340']);
    });

    it('handles quoted cells containing commas', () => {
      expect(parseCSVLine('1,12.34,OK,"R U R\', F2 D"')).toEqual(['1', '12.34', 'OK', 'R U R\', F2 D']);
    });

    it('handles escaped double quotes in quoted cells', () => {
      expect(parseCSVLine('1,"Solve with ""quotes"" in name"')).toEqual(['1', 'Solve with "quotes" in name']);
    });

    it('handles semicolon delimiter', () => {
      expect(parseCSVLine('1;12.34;;R U R\' U\';2026-09-01', ';')).toEqual([
        '1',
        '12.34',
        '',
        'R U R\' U\'',
        '2026-09-01',
      ]);
    });
  });

  describe('App Native JSON Backup Roundtrip', () => {
    const samplePhases: PhaseSplit[] = [
      { name: 'cross', startTs: 1000, endTs: 3000, moveCount: 6, tps: 3.0, recognitionMs: 0 },
      { name: 'f2l-1', startTs: 3000, endTs: 5500, moveCount: 8, tps: 3.2, recognitionMs: 450 },
      { name: 'f2l-2', startTs: 5500, endTs: 7800, moveCount: 7, tps: 3.04, recognitionMs: 320 },
      { name: 'f2l-3', startTs: 7800, endTs: 10100, moveCount: 8, tps: 3.47, recognitionMs: 280 },
      { name: 'f2l-4', startTs: 10100, endTs: 12400, moveCount: 8, tps: 3.47, recognitionMs: 310 },
      { name: 'oll', startTs: 12400, endTs: 14600, moveCount: 9, tps: 4.09, recognitionMs: 520 },
      { name: 'pll', startTs: 14600, endTs: 16800, moveCount: 12, tps: 5.45, recognitionMs: 410 },
    ];

    const sampleSolves: Solve[] = [
      {
        id: 'solve-json-1',
        profileId: 'test-profile',
        scrambleMoves: ['R', 'U', "R'", "U'", "F'", 'L2', 'D'],
        mode: 'timed',
        cubeConnected: true,
        phases: samplePhases,
        totalTimeMs: 15800,
        totalMoves: 58,
        overallTps: 3.67,
        createdAt: 1725200000000,
      },
      {
        id: 'solve-json-2',
        profileId: 'test-profile',
        scrambleMoves: ['F', 'R', 'U', "R'", "U'", "F'"],
        mode: 'timed',
        cubeConnected: false,
        phases: [],
        totalTimeMs: 12500,
        plusTwo: true,
        createdAt: 1725200060000,
      },
      {
        id: 'solve-json-3',
        profileId: 'test-profile',
        scrambleMoves: ['U', 'R', "U'", "R'"],
        mode: 'timed',
        cubeConnected: false,
        phases: [],
        totalTimeMs: 9800,
        dnf: true,
        createdAt: 1725200120000,
      },
    ];

    it('parses backup JSON format and preserves all telemetry and phase splits', () => {
      const backupJson = JSON.stringify({
        version: 1,
        app: 'cube-timer-trainer',
        profileName: 'Main Profile',
        exportedAt: 1725200200000,
        solves: sampleSolves,
      });

      const result = parseHistoryImport(backupJson);
      expect(result.success).toBe(true);
      expect(result.format).toBe('app-json');
      expect(result.solves.length).toBe(3);

      const s1 = result.solves[0];
      expect(s1.totalTimeMs).toBe(15800);
      expect(s1.totalMoves).toBe(58);
      expect(s1.overallTps).toBe(3.67);
      expect(s1.cubeConnected).toBe(true);
      expect(s1.scrambleMoves).toEqual(['R', 'U', "R'", "U'", "F'", 'L2', 'D']);
      expect(s1.phases.length).toBe(7);
      expect(s1.phases[1].name).toBe('f2l-1');
      expect(s1.phases[1].recognitionMs).toBe(450);

      const s2 = result.solves[1];
      expect(s2.totalTimeMs).toBe(12500);
      expect(s2.plusTwo).toBe(true);
      expect(s2.dnf).toBe(false);

      const s3 = result.solves[2];
      expect(s3.totalTimeMs).toBe(9800);
      expect(s3.dnf).toBe(true);
    });

    it('parses raw array of Solve objects', () => {
      const arrayJson = JSON.stringify(sampleSolves);
      const result = parseHistoryImport(arrayJson);
      expect(result.success).toBe(true);
      expect(result.format).toBe('app-json');
      expect(result.solves.length).toBe(3);
    });
  });

  describe('App Native CSV Roundtrip', () => {
    it('parses Cube Trainer CSV export with penalties, moves, tps, and scrambles', () => {
      const csv = [
        'Index,Time (s),Penalty,Raw Time (ms),Moves,TPS,Date,Scramble',
        '3,15.80,OK,15800,58,3.67,2026-09-01T12:00:00.000Z,"R U R\' U\' F\' L2 D"',
        '2,14.50,+2,12500,,,2026-09-01T12:01:00.000Z,"F R U R\' U\' F\'"',
        '1,DNF,DNF,9800,,,2026-09-01T12:02:00.000Z,"U R U\' R\'"',
      ].join('\n');

      const result = parseHistoryImport(csv);
      expect(result.success).toBe(true);
      expect(result.format).toBe('app-csv');
      expect(result.solves.length).toBe(3);

      const s1 = result.solves[0];
      expect(s1.totalTimeMs).toBe(15800);
      expect(s1.totalMoves).toBe(58);
      expect(s1.overallTps).toBe(3.67);
      expect(s1.cubeConnected).toBe(true);
      expect(s1.scrambleMoves).toEqual(['R', 'U', "R'", "U'", "F'", 'L2', 'D']);
      expect(s1.dnf).toBe(false);
      expect(s1.plusTwo).toBe(false);

      const s2 = result.solves[1];
      expect(s2.totalTimeMs).toBe(12500);
      expect(s2.plusTwo).toBe(true);
      expect(s2.dnf).toBe(false);

      const s3 = result.solves[2];
      expect(s3.totalTimeMs).toBe(9800);
      expect(s3.dnf).toBe(true);
    });
  });

  describe('csTimer Format Compatibility', () => {
    it('parses csTimer JSON session export', () => {
      const csTimerJson = JSON.stringify({
        session1: [
          [[0, 12340], "R U R' U'", 'Easy cross', 1725200000],
          [[2000, 14500], "F R U R' U' F'", '', 1725200060],
          [[-1, 11200], "U R U' R'", '', 1725200120],
        ],
        properties: { sessionData: '{}' },
      });

      const result = parseHistoryImport(csTimerJson);
      expect(result.success).toBe(true);
      expect(result.format).toBe('cstimer-json');
      expect(result.solves.length).toBe(3);

      expect(result.solves[0].totalTimeMs).toBe(12340);
      expect(result.solves[0].scrambleMoves).toEqual(['R', 'U', "R'", "U'"]);
      expect(result.solves[0].dnf).toBe(false);
      expect(result.solves[0].plusTwo).toBe(false);
      expect(result.solves[0].createdAt).toBe(1725200000000);

      expect(result.solves[1].totalTimeMs).toBe(12500); // 14500 - 2000 raw
      expect(result.solves[1].plusTwo).toBe(true);
      expect(result.solves[1].dnf).toBe(false);

      expect(result.solves[2].totalTimeMs).toBe(11200);
      expect(result.solves[2].dnf).toBe(true);
    });

    it('parses csTimer CSV export', () => {
      const csTimerCsv = [
        'No.;Total;Comment;Scramble;Date;P.1',
        '1;12.34;;"R U R\' U\'";2026-09-01 12:00:00;',
        '2;14.50+;;"F R U R\' U\' F\'";2026-09-01 12:01:00;',
        '3;DNF(11.20);;"U R U\' R\'";2026-09-01 12:02:00;',
      ].join('\n');

      const result = parseHistoryImport(csTimerCsv);
      expect(result.success).toBe(true);
      expect(result.format).toBe('cstimer-csv');
      expect(result.solves.length).toBe(3);

      expect(result.solves[0].totalTimeMs).toBe(12340);
      expect(result.solves[0].dnf).toBe(false);
      expect(result.solves[0].plusTwo).toBe(false);

      expect(result.solves[1].totalTimeMs).toBe(14500);
      expect(result.solves[1].plusTwo).toBe(true);

      expect(result.solves[2].totalTimeMs).toBe(11200);
      expect(result.solves[2].dnf).toBe(true);
    });
  });

  describe('Corrupt & Edge Case Handling', () => {
    it('returns error on empty input', () => {
      const result = parseHistoryImport('');
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns error on invalid JSON string', () => {
      const result = parseHistoryImport('{ invalid json content: true }');
      expect(result.success).toBe(false);
      expect(result.format).toBe('unknown');
    });

    it('returns error on CSV with no time column', () => {
      const result = parseHistoryImport('Name,Age,City\nAlice,30,Sydney\nBob,25,Melbourne');
      expect(result.success).toBe(false);
    });
  });

  describe('Duplicate Protection & Solve Filtering', () => {
    it('filters out duplicates with matching signatures when skipDuplicates is true and assigns new unique IDs', () => {
      const existing = [
        {
          id: 'solve-a',
          scrambleMoves: ['R', 'U'],
          totalTimeMs: 12000,
          createdAt: 1725200000000,
        },
        {
          id: 'solve-b',
          scrambleMoves: ['F', 'R'],
          totalTimeMs: 14000,
          createdAt: 1725200060000,
        },
      ];

      const toImport = [
        {
          id: 'solve-a', // duplicate by signature (time + scramble + date)
          scrambleMoves: ['R', 'U'],
          mode: 'timed' as const,
          cubeConnected: false,
          phases: [],
          totalTimeMs: 12000,
          createdAt: 1725200000000,
        },
        {
          id: 'solve-other-profile', // duplicate by signature (time + scramble + date)
          scrambleMoves: ['F', 'R'],
          mode: 'timed' as const,
          cubeConnected: false,
          phases: [],
          totalTimeMs: 14000,
          createdAt: 1725200060000,
        },
        {
          id: 'solve-c-from-profile-1', // completely new solve with old ID from another profile
          scrambleMoves: ['U', 'D'],
          mode: 'timed' as const,
          cubeConnected: false,
          phases: [],
          totalTimeMs: 10500,
          createdAt: 1725200120000,
        },
      ];

      const { solvesToAdd, skippedCount } = filterSolvesForImport(existing, toImport, { skipDuplicates: true });
      expect(skippedCount).toBe(2);
      expect(solvesToAdd.length).toBe(1);
      expect(solvesToAdd[0].id).toMatch(/^solve-\d+/);
      expect(solvesToAdd[0].totalTimeMs).toBe(10500);
    });

    it('generates new unique IDs even when importing solves with existing IDs into another profile', () => {
      // Profile B has no existing solves
      const existingInProfileB: any[] = [];
      const toImport = [
        {
          id: 'solve-from-profile-a-1',
          scrambleMoves: ['R', 'U'],
          mode: 'timed' as const,
          cubeConnected: false,
          phases: [],
          totalTimeMs: 12000,
          createdAt: 1725200000000,
        },
      ];

      const { solvesToAdd, skippedCount } = filterSolvesForImport(existingInProfileB, toImport, { skipDuplicates: true });
      expect(skippedCount).toBe(0);
      expect(solvesToAdd.length).toBe(1);
      // Ensure the generated ID is fresh and does not collide with the ID from Profile A
      expect(solvesToAdd[0].id).not.toBe('solve-from-profile-a-1');
      expect(solvesToAdd[0].id).toMatch(/^solve-\d+/);
    });

    it('allows duplicates when skipDuplicates is false', () => {
      const existing = [
        {
          id: 'solve-a',
          scrambleMoves: ['R', 'U'],
          totalTimeMs: 12000,
          createdAt: 1725200000000,
        },
      ];

      const toImport = [
        {
          id: 'solve-a',
          scrambleMoves: ['R', 'U'],
          mode: 'timed' as const,
          cubeConnected: false,
          phases: [],
          totalTimeMs: 12000,
          createdAt: 1725200000000,
        },
      ];

      const { solvesToAdd, skippedCount } = filterSolvesForImport(existing, toImport, { skipDuplicates: false });
      expect(skippedCount).toBe(0);
      expect(solvesToAdd.length).toBe(1);
      expect(solvesToAdd[0].id).toMatch(/^solve-\d+/);
    });
  });
});
