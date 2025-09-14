import { getDb, persistDb } from '@/db/index';
import { leagues } from '@/db/schema';
import { eq } from 'drizzle-orm';

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
