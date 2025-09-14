import { getDb, persistDb } from '@/db/index';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function upsertUser(u: { id: string; username: string; displayName?: string | null }) {
  const db = await getDb();
  await db
    .insert(users)
    .values({ id: u.id, username: u.username, displayName: u.displayName ?? null })
    .onConflictDoUpdate({
      target: users.id,
      set: { username: u.username, displayName: u.displayName ?? null },
    });
  await persistDb();
}

export async function getUserById(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}
