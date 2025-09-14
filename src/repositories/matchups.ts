import { getDb, persistDb } from '@/db/index';
import { matchups } from '@/db/schema';
import { sql } from 'drizzle-orm';

export type NewMatchup = {
  leagueId: string;
  week: number;
  rosterId: number;
  starters?: unknown;
  players?: unknown;
  points?: number | string;
};

export async function upsertMatchups(rows: NewMatchup[]) {
  if (rows.length === 0) return 0;
  const db = await getDb();
  const insert = rows.map((r) => ({
    leagueId: r.leagueId,
    week: r.week,
    rosterId: r.rosterId,
    starters: (r.starters ?? null) as any,
    players: (r.players ?? null) as any,
    points: (r.points ?? 0) as any,
  }));
  await db
    .insert(matchups)
    .values(insert)
    .onConflictDoUpdate({
      target: [matchups.leagueId, matchups.week, matchups.rosterId],
      set: {
        starters: sql`excluded.starters`,
        players: sql`excluded.players`,
        points: sql`excluded.points`,
      },
    });
  await persistDb();
  return insert.length;
}
