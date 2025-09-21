import { getDb, persistDb } from '@/db/index';
import { playerScores } from '@/db/schema';
import { eq, sql, and } from 'drizzle-orm';

export type PlayerScoreUpsert = {
  leagueId: string;
  week: number;
  rosterId: number;
  playerId: string;
  points: number;
  isStarter: boolean;
};

export async function upsertPlayerScore(score: PlayerScoreUpsert) {
  const db = await getDb();
  await db
    .insert(playerScores)
    .values({
      leagueId: score.leagueId,
      week: score.week,
      rosterId: score.rosterId,
      playerId: score.playerId,
      points: String(score.points) as any,
      isStarter: score.isStarter,
    })
    .onConflictDoUpdate({
      target: [playerScores.leagueId, playerScores.week, playerScores.rosterId, playerScores.playerId],
      set: {
        points: sql`excluded.points`,
        isStarter: sql`excluded.is_starter`,
      },
    });
  await persistDb();
}

export async function getPlayerScores(opts: {
  leagueId: string;
  week?: number;
  playerId?: string;
  rosterId?: number;
}) {
  const db = await getDb();
  const conditions = [eq(playerScores.leagueId, opts.leagueId)];

  if (opts.week !== undefined) {
    conditions.push(eq(playerScores.week, opts.week));
  }
  if (opts.playerId) {
    conditions.push(eq(playerScores.playerId, opts.playerId));
  }
  if (opts.rosterId !== undefined) {
    conditions.push(eq(playerScores.rosterId, opts.rosterId));
  }

  return await db.select().from(playerScores).where(and(...conditions));
}

export async function upsertPlayerScoresBulk(rows: PlayerScoreUpsert[]) {
  if (!rows.length) return 0;
  const db = await getDb();
  const CHUNK = 500;
  let total = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map((score) => ({
      leagueId: score.leagueId,
      week: score.week,
      rosterId: score.rosterId,
      playerId: score.playerId,
      points: String(score.points) as any,
      isStarter: score.isStarter,
    }));

    await db
      .insert(playerScores)
      .values(slice)
      .onConflictDoUpdate({
        target: [playerScores.leagueId, playerScores.week, playerScores.rosterId, playerScores.playerId],
        set: {
          points: sql`excluded.points`,
          isStarter: sql`excluded.is_starter`,
        },
      });
    total += slice.length;
  }

  await persistDb();
  return total;
}