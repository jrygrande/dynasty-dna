import { getDb, persistDb } from '@/db/index';
import { playerScores } from '@/db/schema';
import { eq, sql, and, gte, lte, inArray, ne } from 'drizzle-orm';

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

export async function getPlayerScoresForPeriod(params: {
  leagueId: string;
  playerId: string;
  rosterId: number;
  startWeek: number;
  endWeek: number | null; // null means through end of season
  currentWeek?: { season: string; week: number }; // for filtering future weeks
  excludeByeWeek?: boolean; // if true, detect and exclude bye week
}) {
  const db = await getDb();
  const conditions = [
    eq(playerScores.leagueId, params.leagueId),
    eq(playerScores.playerId, params.playerId),
    eq(playerScores.rosterId, params.rosterId),
    gte(playerScores.week, params.startWeek)
  ];

  if (params.endWeek !== null) {
    conditions.push(lte(playerScores.week, params.endWeek));
  }

  // Always exclude week 18 (playoffs) from performance metrics
  conditions.push(lte(playerScores.week, 17));

  // If current week is provided and this league is in the current season,
  // exclude weeks beyond the current week
  if (params.currentWeek) {
    const { getLeagueSeasonMap } = await import('@/repositories/leagues');
    const seasonMap = await getLeagueSeasonMap([params.leagueId]);
    const leagueSeason = seasonMap.get(params.leagueId);

    if (leagueSeason === params.currentWeek.season) {
      conditions.push(lte(playerScores.week, Math.min(params.currentWeek.week, 17)));
    }
  }

  // If bye week exclusion is requested, detect and exclude bye week
  if (params.excludeByeWeek) {
    const { getLeagueSeasonMap } = await import('@/repositories/leagues');
    const { detectByeWeek } = await import('@/services/byeWeekDetection');

    const seasonMap = await getLeagueSeasonMap([params.leagueId]);
    const leagueSeason = seasonMap.get(params.leagueId);

    if (leagueSeason) {
      const byeWeek = await detectByeWeek(params.leagueId, params.playerId, leagueSeason);
      if (byeWeek !== null) {
        conditions.push(ne(playerScores.week, byeWeek));
      }
    }
  }

  return await db.select().from(playerScores).where(and(...conditions));
}

export async function getPlayerActivityByLeague(
  leagueIds: string[],
  playerId: string
): Promise<Array<{
  leagueId: string;
  rosterId: number;
  weekCount: number;
  minWeek: number;
  maxWeek: number;
}>> {
  if (!leagueIds.length) return [];

  const db = await getDb();
  const rows = await db
    .select({
      leagueId: playerScores.leagueId,
      rosterId: playerScores.rosterId,
      weekCount: sql<number>`count(*)`,
      minWeek: sql<number>`min(week)`,
      maxWeek: sql<number>`max(week)`
    })
    .from(playerScores)
    .where(
      and(
        inArray(playerScores.leagueId, leagueIds),
        eq(playerScores.playerId, playerId)
      )
    )
    .groupBy(playerScores.leagueId, playerScores.rosterId);

  return rows;
}