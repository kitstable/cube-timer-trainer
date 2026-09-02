import { db } from './index';
import { getEffectiveTimeMs, type Profile, type Solve } from '../types/db';
import { filterSolvesForImport, type ParsedImportSolve } from '../utils/historyExportImport';

export async function getAllProfiles(): Promise<Profile[]> {
  return await db.profiles.orderBy('createdAt').toArray();
}

export async function createProfile(name: string): Promise<Profile> {
  const newProfile: Profile = {
    id: `profile-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    name: name.trim() || 'New Profile',
    createdAt: Date.now(),
  };
  await db.profiles.add(newProfile);
  return newProfile;
}

export async function updateProfile(id: string, name: string): Promise<void> {
  await db.profiles.update(id, { name: name.trim() });
}

export async function deleteProfile(id: string): Promise<void> {
  await db.solves.where('profileId').equals(id).delete();
  await db.profiles.delete(id);
}

export async function saveSolve(solve: Omit<Solve, 'id' | 'createdAt'>): Promise<Solve> {
  const record: Solve = {
    ...solve,
    id: `solve-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    createdAt: Date.now(),
  };
  await db.solves.add(record);
  return record;
}

export async function updateSolve(id: string, updates: Partial<Solve>): Promise<void> {
  await db.solves.update(id, updates);
}

export async function getSolvesByProfile(profileId: string): Promise<Solve[]> {
  return await db.solves.where('profileId').equals(profileId).reverse().sortBy('createdAt');
}

export async function deleteSolve(id: string): Promise<void> {
  await db.solves.delete(id);
}

export async function clearSolvesByProfile(profileId: string): Promise<void> {
  await db.solves.where('profileId').equals(profileId).delete();
}

export interface ImportSolvesOptions {
  skipDuplicates?: boolean;
}

export async function importSolves(
  profileId: string,
  solvesToImport: ParsedImportSolve[],
  options: ImportSolvesOptions = { skipDuplicates: true }
): Promise<{ importedCount: number; skippedCount: number }> {
  if (solvesToImport.length === 0) {
    return { importedCount: 0, skippedCount: 0 };
  }

  const existingSolves = await db.solves.where('profileId').equals(profileId).toArray();
  const { solvesToAdd, skippedCount } = filterSolvesForImport(existingSolves, solvesToImport, options);

  if (solvesToAdd.length > 0) {
    const fullSolves: Solve[] = solvesToAdd.map((s) => ({
      ...s,
      profileId,
    }));
    await db.solves.bulkAdd(fullSolves);
  }

  return {
    importedCount: solvesToAdd.length,
    skippedCount,
  };
}

export async function getProfileStats(profileId: string): Promise<{ solveCount: number; bestTime: number | null }> {
  const solves = await db.solves.where('profileId').equals(profileId).toArray();
  const validTimes = solves.filter((s) => !s.dnf).map((s) => getEffectiveTimeMs(s));
  return {
    solveCount: solves.length,
    bestTime: validTimes.length > 0 ? Math.min(...validTimes) : null,
  };
}

export interface SessionStats {
  count: number;
  best: number | null;
  bestSolveId: string | null;
  worst: number | null;
  ao5: number | null;
  ao12: number | null;
  mean: number | null;
}

export function computeAverage(times: number[]): number | null {
  if (times.length === 0) return null;
  // If 5 times, trim best and worst (WCA Ao5)
  if (times.length === 5) {
    const sorted = [...times].sort((a, b) => a - b);
    const trimmed = sorted.slice(1, 4);
    return Math.round(trimmed.reduce((a, b) => a + b, 0) / 3);
  }
  // If 12 times, trim best and worst (WCA Ao12: trim 1 best, 1 worst or standard WCA 5% trim)
  if (times.length === 12) {
    const sorted = [...times].sort((a, b) => a - b);
    const trimmed = sorted.slice(1, 11);
    return Math.round(trimmed.reduce((a, b) => a + b, 0) / 10);
  }
  return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
}

export function calculateSessionStats(solves: Solve[]): SessionStats {
  const validSolves = solves.filter((s) => !s.dnf);
  if (validSolves.length === 0) {
    return { count: solves.length, best: null, bestSolveId: null, worst: null, ao5: null, ao12: null, mean: null };
  }

  let bestSolve: Solve = validSolves[0];
  let bestTime = getEffectiveTimeMs(bestSolve);
  let worstTime = bestTime;

  for (const s of validSolves) {
    const t = getEffectiveTimeMs(s);
    if (t < bestTime) {
      bestTime = t;
      bestSolve = s;
    }
    if (t > worstTime) {
      worstTime = t;
    }
  }

  const times = validSolves.map((s) => getEffectiveTimeMs(s));
  const mean = Math.round(times.reduce((a, b) => a + b, 0) / times.length);

  // Latest 5 solves for Ao5
  const latest5 = validSolves.slice(0, 5).map((s) => getEffectiveTimeMs(s));
  const ao5 = latest5.length === 5 ? computeAverage(latest5) : null;

  // Latest 12 solves for Ao12
  const latest12 = validSolves.slice(0, 12).map((s) => getEffectiveTimeMs(s));
  const ao12 = latest12.length === 12 ? computeAverage(latest12) : null;

  return {
    count: solves.length,
    best: bestTime,
    bestSolveId: bestSolve ? bestSolve.id : null,
    worst: worstTime,
    ao5,
    ao12,
    mean,
  };
}

