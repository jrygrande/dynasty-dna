import { getDb, persistDb } from '@/db/index';
import { nflState, nflSeasons } from '@/db/schema';
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

export async function upsertNFLSeasons(rows: { season: string; maxWeek: number; note?: string | null }[]) {
  if (!rows.length) return 0;
  const db = await getDb();
  const CHUNK = 100;
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map((r) => ({
      season: String(r.season),
      maxWeek: Number(r.maxWeek),
      note: r.note ?? null,
      updatedAt: sql`now()` as any,
    }));
    await db
      .insert(nflSeasons)
      .values(slice)
      .onConflictDoUpdate({
        target: nflSeasons.season,
        set: { maxWeek: sql`excluded.max_week`, note: sql`excluded.note`, updatedAt: sql`now()` },
      });
    total += slice.length;
  }
  await persistDb();
  return total;
}
