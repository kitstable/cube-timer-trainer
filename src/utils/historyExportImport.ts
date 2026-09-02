import { getEffectiveTimeMs, type PhaseSplit, type Solve } from '../types/db';

export interface ParsedImportSolve {
  id?: string;
  scrambleMoves: string[];
  mode: 'timed' | 'guided';
  cubeConnected: boolean;
  phases: PhaseSplit[];
  totalTimeMs: number;
  totalMoves?: number;
  overallTps?: number;
  dnf?: boolean;
  plusTwo?: boolean;
  createdAt: number;
}

export type ImportFormatType =
  | 'app-json'
  | 'app-csv'
  | 'cstimer-json'
  | 'cstimer-csv'
  | 'generic-csv'
  | 'unknown';

export interface ImportParseResult {
  success: boolean;
  format: ImportFormatType;
  formatLabel: string;
  solves: ParsedImportSolve[];
  errors: string[];
  warnings: string[];
  totalParsed: number;
}

/**
 * Triggers browser download for text/blob content.
 */
function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generates and downloads a CSV export of the provided solves.
 */
export function exportSolvesCSV(solves: Solve[], profileName: string): void {
  const headers = ['Index', 'Time (s)', 'Penalty', 'Raw Time (ms)', 'Moves', 'TPS', 'Date', 'Scramble'];
  const rows = solves.map((s, idx) => {
    const penalty = s.dnf ? 'DNF' : s.plusTwo ? '+2' : 'OK';
    const effectiveSec = s.dnf ? 'DNF' : (getEffectiveTimeMs(s) / 1000).toFixed(2);
    const moves = s.totalMoves !== undefined ? s.totalMoves : '';
    const tps = s.overallTps !== undefined ? s.overallTps : '';
    const date = new Date(s.createdAt).toISOString();
    const scramble = s.scrambleMoves.join(' ');
    return [
      solves.length - idx,
      effectiveSec,
      penalty,
      s.totalTimeMs,
      moves,
      tps,
      date,
      `"${scramble.replace(/"/g, '""')}"`,
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');
  const filename = `solves_${profileName.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
  downloadFile(filename, csvContent, 'text/csv;charset=utf-8;');
}

/**
 * Generates and downloads a full-fidelity JSON backup containing all phase splits and telemetry.
 */
export function exportSolvesJSON(solves: Solve[], profileName: string): void {
  const backupData = {
    version: 1,
    app: 'cube-timer-trainer',
    profileName,
    exportedAt: Date.now(),
    solveCount: solves.length,
    solves,
  };

  const jsonContent = JSON.stringify(backupData, null, 2);
  const filename = `backup_${profileName.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
  downloadFile(filename, jsonContent, 'application/json;charset=utf-8;');
}

/**
 * Parses time formatted like "12.34", "1:05.42", "1:02:03.45", "DNF(12.34)", "12.34+" into ms and penalty.
 */
export function parseTimeString(timeStr: string): { timeMs: number; dnf: boolean; plusTwo: boolean } {
  let str = (timeStr || '').trim();
  let dnf = false;
  let plusTwo = false;

  if (/^dnf/i.test(str)) {
    dnf = true;
    const innerMatch = str.match(/\(([^)]+)\)/);
    if (innerMatch) {
      str = innerMatch[1].trim();
    } else {
      return { timeMs: 0, dnf: true, plusTwo: false };
    }
  }

  if (str.endsWith('+') || /\(\+2\)$/i.test(str)) {
    plusTwo = true;
    str = str.replace(/\+$|\(\+2\)$/i, '').trim();
  }

  // Check format: [[hours:]minutes:]seconds[.millis]
  const parts = str.split(':');
  let seconds = 0;

  if (parts.length === 1) {
    seconds = parseFloat(parts[0]);
  } else if (parts.length === 2) {
    const mins = parseFloat(parts[0]);
    const secs = parseFloat(parts[1]);
    seconds = mins * 60 + secs;
  } else if (parts.length === 3) {
    const hrs = parseFloat(parts[0]);
    const mins = parseFloat(parts[1]);
    const secs = parseFloat(parts[2]);
    seconds = hrs * 3600 + mins * 60 + secs;
  }

  if (isNaN(seconds) || seconds < 0) {
    return { timeMs: 0, dnf: dnf || false, plusTwo };
  }

  const timeMs = Math.round(seconds * 1000);
  return { timeMs, dnf, plusTwo };
}

/**
 * Parses a single CSV line taking quoted cells into account.
 */
export function parseCSVLine(line: string, delimiter: string = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Pure helper to filter and prepare solves for import with duplicate detection.
 */
export function filterSolvesForImport(
  existingSolves: Array<Pick<Solve, 'id' | 'createdAt' | 'scrambleMoves' | 'totalTimeMs'>>,
  solvesToImport: ParsedImportSolve[],
  options: { skipDuplicates?: boolean } = { skipDuplicates: true }
): { solvesToAdd: Array<Omit<Solve, 'profileId'>>; skippedCount: number } {
  if (solvesToImport.length === 0) {
    return { solvesToAdd: [], skippedCount: 0 };
  }

  const existingSignatures = new Set(
    existingSolves.map((s) => `${Math.floor(s.createdAt / 1000)}_${s.scrambleMoves.join(' ')}_${s.totalTimeMs}`)
  );

  const solvesToAdd: Array<Omit<Solve, 'profileId'>> = [];
  let skippedCount = 0;

  for (let i = 0; i < solvesToImport.length; i++) {
    const s = solvesToImport[i];
    const signature = `${Math.floor(s.createdAt / 1000)}_${s.scrambleMoves.join(' ')}_${s.totalTimeMs}`;

    if (options.skipDuplicates) {
      if (existingSignatures.has(signature)) {
        skippedCount++;
        continue;
      }
    }

    const id = `solve-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`;
    existingSignatures.add(signature);

    solvesToAdd.push({
      id,
      scrambleMoves: s.scrambleMoves || [],
      mode: s.mode || 'timed',
      cubeConnected: Boolean(s.cubeConnected),
      phases: s.phases || [],
      totalTimeMs: s.totalTimeMs,
      totalMoves: s.totalMoves,
      overallTps: s.overallTps,
      dnf: Boolean(s.dnf),
      plusTwo: Boolean(s.plusTwo),
      createdAt: s.createdAt,
    });
  }

  return { solvesToAdd, skippedCount };
}

/**
 * Parses history export file (JSON or CSV/Text) and returns standardized solves.
 */
export function parseHistoryImport(content: string, _filename?: string): ImportParseResult {
  const trimmed = (content || '').trim();
  if (!trimmed) {
    return {
      success: false,
      format: 'unknown',
      formatLabel: 'Empty File',
      solves: [],
      errors: ['File content is empty.'],
      warnings: [],
      totalParsed: 0,
    };
  }

  // 1. Try JSON Parsing first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsedJson = JSON.parse(trimmed);
      return parseJsonImport(parsedJson);
    } catch (e: any) {
      // If it looks like JSON but has syntax error, report error
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return {
          success: false,
          format: 'unknown',
          formatLabel: 'Invalid JSON',
          solves: [],
          errors: [`Failed to parse JSON: ${e.message}`],
          warnings: [],
          totalParsed: 0,
        };
      }
    }
  }

  // 2. Fall back to CSV / Text parsing
  return parseCsvImport(trimmed);
}

/**
 * Handles JSON data parsing (App Backup or csTimer format).
 */
function parseJsonImport(data: any): ImportParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Case A: App Backup JSON ({ solves: Solve[] } or Solve[])
  const rawSolvesList: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.solves)
    ? data.solves
    : null;

  if (rawSolvesList && rawSolvesList.length > 0 && typeof rawSolvesList[0] === 'object' && ('totalTimeMs' in rawSolvesList[0] || 'scrambleMoves' in rawSolvesList[0])) {
    const solves: ParsedImportSolve[] = [];

    for (let i = 0; i < rawSolvesList.length; i++) {
      const s = rawSolvesList[i];
      if (typeof s !== 'object' || s === null) continue;

      const totalTimeMs = typeof s.totalTimeMs === 'number' ? s.totalTimeMs : 0;
      if (totalTimeMs <= 0 && !s.dnf) {
        warnings.push(`Solve at index ${i} has invalid time and was skipped.`);
        continue;
      }

      let scrambleMoves: string[] = [];
      if (Array.isArray(s.scrambleMoves)) {
        scrambleMoves = s.scrambleMoves.map(String).filter(Boolean);
      } else if (typeof s.scrambleMoves === 'string') {
        scrambleMoves = s.scrambleMoves.trim().split(/\s+/).filter(Boolean);
      } else if (typeof s.scramble === 'string') {
        scrambleMoves = s.scramble.trim().split(/\s+/).filter(Boolean);
      }

      const createdAt = typeof s.createdAt === 'number' ? s.createdAt : Date.now() - (rawSolvesList.length - i) * 1000;

      solves.push({
        id: typeof s.id === 'string' ? s.id : undefined,
        scrambleMoves,
        mode: s.mode === 'guided' ? 'guided' : 'timed',
        cubeConnected: Boolean(s.cubeConnected),
        phases: Array.isArray(s.phases) ? s.phases : [],
        totalTimeMs,
        totalMoves: typeof s.totalMoves === 'number' ? s.totalMoves : undefined,
        overallTps: typeof s.overallTps === 'number' ? s.overallTps : undefined,
        dnf: Boolean(s.dnf),
        plusTwo: Boolean(s.plusTwo),
        createdAt,
      });
    }

    return {
      success: solves.length > 0,
      format: 'app-json',
      formatLabel: 'Cube Trainer JSON Backup',
      solves,
      errors,
      warnings,
      totalParsed: solves.length,
    };
  }

  // Case B: csTimer JSON format (contains "session1", "session2", etc.)
  let isCsTimer = false;
  const csTimerSolves: ParsedImportSolve[] = [];

  if (typeof data === 'object' && data !== null) {
    const sessionKeys = Object.keys(data).filter((k) => /^session\d+$/i.test(k));
    if (sessionKeys.length > 0) {
      isCsTimer = true;
      for (const sessionKey of sessionKeys) {
        const sessionSolves = data[sessionKey];
        if (!Array.isArray(sessionSolves)) continue;

        for (const entry of sessionSolves) {
          // Entry format: [ [penalty, timeMs], scrambleStr, commentStr, timestampSec ]
          if (!Array.isArray(entry) || entry.length < 2) continue;

          const timeInfo = entry[0];
          const scrambleStr = typeof entry[1] === 'string' ? entry[1] : '';
          const timestamp = typeof entry[3] === 'number' ? entry[3] : 0;

          let rawTimeMs = 0;
          let dnf = false;
          let plusTwo = false;

          if (Array.isArray(timeInfo)) {
            const penalty = timeInfo[0];
            const recordedTime = timeInfo[1];
            if (penalty === -1) {
              dnf = true;
              rawTimeMs = recordedTime;
            } else if (penalty === 2000) {
              plusTwo = true;
              rawTimeMs = recordedTime > 2000 ? recordedTime - 2000 : recordedTime;
            } else {
              rawTimeMs = recordedTime;
            }
          } else if (typeof timeInfo === 'number') {
            rawTimeMs = timeInfo;
          }

          if (rawTimeMs <= 0 && !dnf) continue;

          // csTimer timestamp is typically in seconds
          const createdAt = timestamp > 0
            ? (timestamp < 10000000000 ? timestamp * 1000 : timestamp)
            : Date.now();

          const scrambleMoves = scrambleStr.trim().split(/\s+/).filter(Boolean);

          csTimerSolves.push({
            scrambleMoves,
            mode: 'timed',
            cubeConnected: false,
            phases: [],
            totalTimeMs: rawTimeMs,
            dnf,
            plusTwo,
            createdAt,
          });
        }
      }
    }
  }

  if (isCsTimer) {
    return {
      success: csTimerSolves.length > 0,
      format: 'cstimer-json',
      formatLabel: 'csTimer JSON Export',
      solves: csTimerSolves,
      errors: csTimerSolves.length === 0 ? ['No valid solves found in csTimer JSON sessions.'] : [],
      warnings,
      totalParsed: csTimerSolves.length,
    };
  }

  return {
    success: false,
    format: 'unknown',
    formatLabel: 'Unrecognized JSON',
    solves: [],
    errors: ['Unrecognized JSON structure. Expected Cube Trainer backup or csTimer JSON format.'],
    warnings: [],
    totalParsed: 0,
  };
}

/**
 * Handles CSV/Text parsing.
 */
function parseCsvImport(text: string): ImportParseResult {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      success: false,
      format: 'unknown',
      formatLabel: 'Empty CSV',
      solves: [],
      errors: ['No lines to parse.'],
      warnings: [],
      totalParsed: 0,
    };
  }

  // Detect delimiter (, or ; or \t)
  const firstLine = lines[0];
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;

  let delimiter = ',';
  if (semicolonCount > commaCount && semicolonCount > tabCount) {
    delimiter = ';';
  } else if (tabCount > commaCount && tabCount > semicolonCount) {
    delimiter = '\t';
  }

  const headerCells = parseCSVLine(firstLine, delimiter).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

  // Detect if App CSV format
  const isAppCsv =
    headerCells.includes('time') ||
    headerCells.includes('times') ||
    (headerCells.includes('rawtimems') && headerCells.includes('scramble'));

  // Detect csTimer CSV format: No.;Total;Comment;Scramble;Date
  const isCsTimerCsv =
    headerCells.includes('no') && (headerCells.includes('total') || headerCells.includes('time')) && headerCells.includes('scramble');

  let format: ImportFormatType = 'generic-csv';
  let formatLabel = 'CSV Export';

  if (isAppCsv && headerCells.includes('rawtimems')) {
    format = 'app-csv';
    formatLabel = 'Cube Trainer CSV';
  } else if (isCsTimerCsv) {
    format = 'cstimer-csv';
    formatLabel = 'csTimer CSV';
  }

  // Map header columns to indices
  let timeCol = -1;
  let rawTimeCol = -1;
  let penaltyCol = -1;
  let movesCol = -1;
  let tpsCol = -1;
  let dateCol = -1;
  let scrambleCol = -1;

  for (let c = 0; c < headerCells.length; c++) {
    const col = headerCells[c];
    if (col === 'rawtimems' || col === 'rawtime') rawTimeCol = c;
    else if (col === 'time' || col === 'times' || col === 'total' || col === 'result') timeCol = c;
    else if (col === 'penalty') penaltyCol = c;
    else if (col === 'moves' || col === 'totalmoves') movesCol = c;
    else if (col === 'tps' || col === 'overalltps') tpsCol = c;
    else if (col === 'date' || col === 'timestamp' || col === 'createdat') dateCol = c;
    else if (col === 'scramble' || col === 'scramblemoves') scrambleCol = c;
  }

  // If header wasn't detected properly (e.g. no header, first row is data)
  let startLine = 1;
  if (timeCol === -1 && rawTimeCol === -1 && scrambleCol === -1) {
    // Check if line 0 looks like data
    const parsedLine0 = parseCSVLine(lines[0], delimiter);
    if (parsedLine0.some((cell) => /^\d+(\.\d+)?$/.test(cell))) {
      startLine = 0;
      // Default standard order: [Index, Time, Penalty, RawTime, Moves, TPS, Date, Scramble] or [Time, Scramble, Date]
      if (parsedLine0.length >= 8) {
        timeCol = 1;
        penaltyCol = 2;
        rawTimeCol = 3;
        movesCol = 4;
        tpsCol = 5;
        dateCol = 6;
        scrambleCol = 7;
      } else if (parsedLine0.length >= 4) {
        timeCol = 0;
        scrambleCol = 1;
        dateCol = 2;
      } else {
        timeCol = 0;
        scrambleCol = 1;
      }
    }
  }

  if (timeCol === -1 && rawTimeCol === -1) {
    return {
      success: false,
      format: 'unknown',
      formatLabel: 'Unrecognized CSV',
      solves: [],
      errors: ['Could not locate a time column in the CSV.'],
      warnings: [],
      totalParsed: 0,
    };
  }

  const solves: ParsedImportSolve[] = [];
  const warnings: string[] = [];

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const cells = parseCSVLine(line, delimiter);
    const timeCell = timeCol !== -1 ? cells[timeCol] : '';
    const rawTimeCell = rawTimeCol !== -1 ? cells[rawTimeCol] : '';
    const penaltyCell = penaltyCol !== -1 ? cells[penaltyCol] : '';
    const movesCell = movesCol !== -1 ? cells[movesCol] : '';
    const tpsCell = tpsCol !== -1 ? cells[tpsCol] : '';
    const dateCell = dateCol !== -1 ? cells[dateCol] : '';
    const scrambleCell = scrambleCol !== -1 ? cells[scrambleCol] : '';

    const parsedTime = parseTimeString(timeCell);
    let totalTimeMs = parsedTime.timeMs;
    let dnf = parsedTime.dnf;
    let plusTwo = parsedTime.plusTwo;

    // If explicit raw time is provided, use it
    if (rawTimeCell) {
      const rawNum = parseInt(rawTimeCell, 10);
      if (!isNaN(rawNum) && rawNum > 0) {
        totalTimeMs = rawNum;
      }
    }

    // Check explicit penalty column
    if (penaltyCell) {
      const pen = penaltyCell.trim().toUpperCase();
      if (pen === 'DNF') dnf = true;
      else if (pen === '+2') plusTwo = true;
      else if (pen === 'OK' || pen === 'NONE' || pen === '0') {
        // no penalty
      }
    }

    if (totalTimeMs <= 0 && !dnf) {
      warnings.push(`Row ${i + 1} has invalid time and was skipped.`);
      continue;
    }

    // Parse scramble
    const scrambleMoves = (scrambleCell || '').trim().split(/\s+/).filter(Boolean);

    // Parse date
    let createdAt = Date.now() - (lines.length - i) * 1000;
    if (dateCell) {
      const parsedDate = Date.parse(dateCell);
      if (!isNaN(parsedDate)) {
        createdAt = parsedDate;
      } else {
        const num = Number(dateCell);
        if (!isNaN(num) && num > 0) {
          createdAt = num < 10000000000 ? num * 1000 : num;
        }
      }
    }

    const totalMoves = movesCell ? parseInt(movesCell, 10) : undefined;
    const overallTps = tpsCell ? parseFloat(tpsCell) : undefined;
    const cubeConnected = totalMoves !== undefined || overallTps !== undefined;

    solves.push({
      scrambleMoves,
      mode: 'timed',
      cubeConnected,
      phases: [],
      totalTimeMs,
      totalMoves: isNaN(totalMoves as number) ? undefined : totalMoves,
      overallTps: isNaN(overallTps as number) ? undefined : overallTps,
      dnf,
      plusTwo,
      createdAt,
    });
  }

  return {
    success: solves.length > 0,
    format,
    formatLabel,
    solves,
    errors: solves.length === 0 ? ['No valid solve rows found in CSV.'] : [],
    warnings,
    totalParsed: solves.length,
  };
}
