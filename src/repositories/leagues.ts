import { getDb, persistDb } from '@/db/index';
import { leagues } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';

export async function upsertLeague(l: { id: string; name: string; season: string; previousLeagueId?: string | null; settings?: unknown }) {
  const db = await getDb();
  await db
    .insert(leagues)
    .values({ id: l.id, name: l.name, season: l.season, previousLeagueId: l.previousLeagueId ?? null, settings: (l.settings ?? null) as any })
    .onConflictDoUpdate({ target: leagues.id, set: { name: l.name, season: l.season, previousLeagueId: l.previousLeagueId ?? null, settings: (l.settings ?? null) as any } });
  await persistDb();
}

export async function getLeague(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(leagues).where(eq(leagues.id, id)).limit(1);
  return row ?? null;
}

export async function getLeagueSeasonMap(leagueIds: string[]): Promise<Map<string, string>> {
  if (!leagueIds.length) return new Map();

  const db = await getDb();
  const rows = await db
    .select({ id: leagues.id, season: leagues.season })
    .from(leagues)
    .where(inArray(leagues.id, leagueIds));

  return new Map(rows.map(r => [r.id, r.season]));
}

export async function updateLastAssetEventsSyncTime(leagueId: string) {
  const db = await getDb();
  await db
    .update(leagues)
    .set({ lastAssetEventsSyncAt: new Date() })
    .where(eq(leagues.id, leagueId));
  await persistDb();
}

export async function getLastAssetEventsSyncTime(leagueId: string): Promise<Date | null> {
  const db = await getDb();
  const [row] = await db
    .select({ lastAssetEventsSyncAt: leagues.lastAssetEventsSyncAt })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  return row?.lastAssetEventsSyncAt ?? null;
}

export async function updateLeagueSyncStatus(leagueId: string, status: 'idle' | 'syncing' | 'failed', lastSyncAt?: Date) {
  const db = await getDb();
  const updateData: any = { syncStatus: status };

  if (status === 'syncing') {
    // Track when sync started for stuck detection
    updateData.syncStartedAt = new Date();
  } else if (status === 'idle' || status === 'failed') {
    // Clear started time when sync finishes
    updateData.syncStartedAt = null;
  }

  if (lastSyncAt) {
    updateData.lastSyncAt = lastSyncAt;
  }

  await db
    .update(leagues)
    .set(updateData)
    .where(eq(leagues.id, leagueId));
  await persistDb();
}

export async function getLeagueSyncInfo(leagueId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      lastSyncAt: leagues.lastSyncAt,
      syncStartedAt: leagues.syncStartedAt,
      syncStatus: leagues.syncStatus,
      syncVersion: leagues.syncVersion,
    })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  return row ?? null;
}

export async function isLeagueDataStale(leagueId: string, thresholdHours: number): Promise<boolean> {
  const syncInfo = await getLeagueSyncInfo(leagueId);

  if (!syncInfo?.lastSyncAt) {
    return true; // No sync time = stale
  }

  const thresholdMs = thresholdHours * 60 * 60 * 1000;
  const stalenessTime = Date.now() - thresholdMs;

  return syncInfo.lastSyncAt.getTime() < stalenessTime;
}
