import { getDb, persistDb } from '@/db/index';
import { transactions } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';

export type NewTransaction = {
  id: string;
  leagueId: string;
  week: number | null;
  type: string;
  payload: unknown;
};

export async function upsertTransactions(rows: NewTransaction[]) {
  if (rows.length === 0) return 0;
  const db = await getDb();
  const insert = rows.map((r) => ({
    id: r.id,
    leagueId: r.leagueId,
    week: r.week ?? null,
    type: r.type,
    payload: (r.payload ?? null) as any,
  }));
  const res = await db
    .insert(transactions)
    .values(insert)
    .onConflictDoUpdate({
      target: transactions.id,
      set: {
        leagueId: sql`excluded.league_id`,
        week: sql`excluded.week`,
        type: sql`excluded.type`,
        payload: sql`excluded.payload`,
      },
    });
  await persistDb();
  // drizzle doesn't return affected rowcount here; return inserted length for now
  return insert.length;
}
