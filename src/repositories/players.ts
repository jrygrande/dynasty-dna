import { getDb, persistDb } from '@/db/index';
import { players } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';

export async function upsertPlayer(p: { id: string; name: string; position?: string | null; team?: string | null; status?: string | null }) {
  const db = await getDb();
  await db
    .insert(players)
    .values({ id: p.id, name: p.name, position: p.position ?? null, team: p.team ?? null, status: p.status ?? null })
    .onConflictDoUpdate({ target: players.id, set: { name: p.name, position: p.position ?? null, team: p.team ?? null, status: p.status ?? null } });
  await persistDb();
}

export async function getPlayer(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(players).where(eq(players.id, id)).limit(1);
  return row ?? null;
}

export type PlayerUpsert = {
  id: string;
  name: string;
  position?: string | null;
  team?: string | null;
  status?: string | null;
};

export async function upsertPlayersBulk(rows: PlayerUpsert[]) {
  if (!rows.length) return 0;
  const db = await getDb();
  const CHUNK = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position ?? null,
      team: p.team ?? null,
      status: p.status ?? null,
      updatedAt: sql`now()` as any,
    }));
    await db
      .insert(players)
      .values(slice)
      .onConflictDoUpdate({
        target: players.id,
        set: {
          name: sql`excluded.name`,
          position: sql`excluded.position`,
          team: sql`excluded.team`,
          status: sql`excluded.status`,
          updatedAt: sql`now()`
        },
      });
    total += slice.length;
  }
  await persistDb();
  return total;
}
