import { getDb, persistDb } from '@/db/index';
import { players } from '@/db/schema';
import { eq } from 'drizzle-orm';

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
