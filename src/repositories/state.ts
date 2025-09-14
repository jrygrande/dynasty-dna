import { getDb, persistDb } from '@/db/index';
import { nflState } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';

export async function upsertNFLState(state: { season: string; week: number }) {
  const db = await getDb();
  await db
    .insert(nflState)
    .values({ id: 'nfl', season: String(state.season), week: Number(state.week) || 0 })
    .onConflictDoUpdate({ target: nflState.id, set: { season: sql`excluded.season`, week: sql`excluded.week`, fetchedAt: sql`now()` } });
  await persistDb();
}

export async function getNFLState() {
  const db = await getDb();
  const [row] = await db.select().from(nflState).where(eq(nflState.id, 'nfl')).limit(1);
  return row || null;
}

