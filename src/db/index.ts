import Dexie, { type EntityTable } from 'dexie';
import type { Profile, Solve } from '../types/db';

export class CubeDatabase extends Dexie {
  profiles!: EntityTable<Profile, 'id'>;
  solves!: EntityTable<Solve, 'id'>;

  constructor() {
    super('CubeTrainerDB');
    this.version(1).stores({
      profiles: 'id, name, createdAt',
      solves: 'id, profileId, mode, cubeConnected, totalTimeMs, createdAt',
    });
  }
}

export const db = new CubeDatabase();

const DEFAULT_PROFILE_ID = 'default-profile';

/**
 * Initializes the default profile if none exists.
 */
export async function initializeDatabase(): Promise<string> {
  const count = await db.profiles.count();
  if (count === 0) {
    await db.profiles.add({
      id: DEFAULT_PROFILE_ID,
      name: 'Main Profile',
      createdAt: Date.now(),
    });
    return DEFAULT_PROFILE_ID;
  }
  const first = await db.profiles.orderBy('createdAt').first();
  return first ? first.id : DEFAULT_PROFILE_ID;
}
