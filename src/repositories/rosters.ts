import { getDb, persistDb } from '@/db/index';
import { rosters } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

export async function upsertRoster(r: { leagueId: string; rosterId: number; ownerId: string }) {
  const db = await getDb();
  await db
    .insert(rosters)
    .values({ leagueId: r.leagueId, rosterId: r.rosterId, ownerId: r.ownerId })
    .onConflictDoUpdate({ target: [rosters.leagueId, rosters.rosterId], set: { ownerId: r.ownerId } });
  await persistDb();
}

export async function getRoster(leagueId: string, rosterId: number) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(rosters)
    .where(and(eq(rosters.leagueId, leagueId), eq(rosters.rosterId, rosterId)))
    .limit(1);
  return row ?? null;
}
