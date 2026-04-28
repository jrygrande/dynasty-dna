import { and, eq, inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { resolveFamily } from "@/lib/familyResolution";

export interface StintStatsInput {
  familyId: string;
  playerId: string;
  managerUserId: string;
  startSeason: string;
  startWeek: number;
  /** null/undefined ⇒ ongoing — runs through the latest played week in the family */
  endSeason?: string | null;
  endWeek?: number | null;
}

export interface StintStats {
  ppg: number | null;
  ppgStarting: number | null;
  startPct: number | null;
  activePct: number | null;
  /** Stint weeks that weren't byes (denominator for Active %). */
  weeksAvailable: number;
  /** Non-bye stint weeks where the player was on an NFL active roster (status=ACT). */
  weeksActive: number;
  /** Subset of weeksActive where the manager started the player. */
  starterWeeks: number;
  /** Sum of points across active weeks only (bye and inactive weeks excluded). */
  totalPoints: number;
  /** Sum of points across active+starter weeks. */
  starterPoints: number;
  byeWeeksExcluded: number;
}

/**
 * Compute stint-scoped stats for a player on a single roster across the family
 * leagues. Bye weeks are excluded from rate denominators.
 */
export async function computePlayerStintStats(
  input: StintStatsInput,
): Promise<StintStats | null> {
  const {
    familyId,
    playerId,
    managerUserId,
    startSeason,
    startWeek,
    endSeason,
    endWeek,
  } = input;

  const db = getDb();
  const resolvedFamilyId = await resolveFamily(familyId);
  if (!resolvedFamilyId) return null;

  const members = await db
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, resolvedFamilyId));
  if (members.length === 0) return emptyStats();

  const startSeasonNum = parseInt(startSeason, 10);
  const endSeasonNum = endSeason ? parseInt(endSeason, 10) : Infinity;
  const inRangeMembers = members.filter((m) => {
    const s = parseInt(m.season, 10);
    return s >= startSeasonNum && s <= endSeasonNum;
  });
  if (inRangeMembers.length === 0) return emptyStats();

  const leagueIds = inRangeMembers.map((m) => m.leagueId);
  const leagueSeasonMap = new Map(inRangeMembers.map((m) => [m.leagueId, m.season]));

  const [rosterRows, matchupRows, playerRow] = await Promise.all([
    db
      .select({
        leagueId: schema.rosters.leagueId,
        rosterId: schema.rosters.rosterId,
      })
      .from(schema.rosters)
      .where(
        and(
          inArray(schema.rosters.leagueId, leagueIds),
          eq(schema.rosters.ownerId, managerUserId),
        ),
      ),
    db
      .select({
        leagueId: schema.matchups.leagueId,
        week: schema.matchups.week,
      })
      .from(schema.matchups)
      .where(inArray(schema.matchups.leagueId, leagueIds)),
    db
      .select({ gsisId: schema.players.gsisId })
      .from(schema.players)
      .where(eq(schema.players.id, playerId))
      .limit(1),
  ]);

  const leagueRosterMap = new Map(rosterRows.map((r) => [r.leagueId, r.rosterId]));
  if (leagueRosterMap.size === 0) return emptyStats();

  const windowKeys = new Set<string>();
  for (const m of matchupRows) {
    const season = leagueSeasonMap.get(m.leagueId);
    if (!season) continue;
    if (!isInWindow(season, m.week, startSeason, startWeek, endSeason, endWeek)) {
      continue;
    }
    windowKeys.add(`${season}|${m.week}`);
  }

  const gsisId = playerRow[0]?.gsisId ?? null;

  const seasonsInWindow = [...new Set([...windowKeys].map((k) => parseInt(k.split("|")[0], 10)))];
  const byeKeys = new Set<string>();
  const activeKeys = new Set<string>();

  if (gsisId && seasonsInWindow.length > 0) {
    const [statusRows, scheduleRows] = await Promise.all([
      db
        .select()
        .from(schema.nflWeeklyRosterStatus)
        .where(
          and(
            eq(schema.nflWeeklyRosterStatus.gsisId, gsisId),
            inArray(schema.nflWeeklyRosterStatus.season, seasonsInWindow),
          ),
        ),
      db
        .select()
        .from(schema.nflSchedule)
        .where(inArray(schema.nflSchedule.season, seasonsInWindow)),
    ]);

    const playerTeamByWeek = new Map<string, string>();
    const playerStatusByWeek = new Map<string, string>();
    for (const r of statusRows) {
      const key = `${r.season}|${r.week}`;
      if (r.team) playerTeamByWeek.set(key, r.team);
      playerStatusByWeek.set(key, r.status);
    }

    const teamPlayedWeeks = new Map<string, Set<number>>();
    const seasonAllWeeks = new Map<number, Set<number>>();
    const addTeamWeek = (season: number, team: string, week: number) => {
      const key = `${season}|${team}`;
      const set = teamPlayedWeeks.get(key) ?? new Set<number>();
      set.add(week);
      teamPlayedWeeks.set(key, set);
    };
    for (const g of scheduleRows) {
      const allWeeksSet = seasonAllWeeks.get(g.season) ?? new Set<number>();
      allWeeksSet.add(g.week);
      seasonAllWeeks.set(g.season, allWeeksSet);
      addTeamWeek(g.season, g.homeTeam, g.week);
      addTeamWeek(g.season, g.awayTeam, g.week);
    }

    for (const key of windowKeys) {
      const [seasonStr, weekStr] = key.split("|");
      const seasonNum = parseInt(seasonStr, 10);
      const weekNum = parseInt(weekStr, 10);
      const allWeeks = seasonAllWeeks.get(seasonNum);
      if (!allWeeks || !allWeeks.has(weekNum)) continue;

      // Mid-season status rows occasionally drop; infer the player's team from
      // the nearest week with data so we don't misclassify byes.
      let team = playerTeamByWeek.get(key) ?? null;
      if (!team) {
        for (let delta = 1; delta <= 18 && !team; delta++) {
          team =
            playerTeamByWeek.get(`${seasonNum}|${weekNum - delta}`) ??
            playerTeamByWeek.get(`${seasonNum}|${weekNum + delta}`) ??
            null;
        }
      }
      if (!team) continue;

      const teamWeeks = teamPlayedWeeks.get(`${seasonNum}|${team}`);
      if (teamWeeks && !teamWeeks.has(weekNum)) {
        byeKeys.add(key);
      }
    }

    for (const key of windowKeys) {
      if (byeKeys.has(key)) continue;
      if (playerStatusByWeek.get(key) === "ACT") activeKeys.add(key);
    }
  } else {
    // No NFL status data available — treat every non-bye window week as active
    // so we don't artificially deflate Active % for older or unsigned players.
    for (const key of windowKeys) {
      if (!byeKeys.has(key)) activeKeys.add(key);
    }
  }

  const weeksAvailable = windowKeys.size - byeKeys.size;

  const perLeaguePairs = [...leagueRosterMap.entries()].map(([lid, rid]) =>
    and(
      eq(schema.playerScores.leagueId, lid),
      eq(schema.playerScores.rosterId, rid),
    ),
  );
  const scoreRows = await db
    .select({
      leagueId: schema.playerScores.leagueId,
      week: schema.playerScores.week,
      points: schema.playerScores.points,
      isStarter: schema.playerScores.isStarter,
    })
    .from(schema.playerScores)
    .where(
      and(
        eq(schema.playerScores.playerId, playerId),
        or(...perLeaguePairs)!,
      ),
    );

  let starterWeeks = 0;
  let totalPoints = 0;
  let starterPoints = 0;
  for (const s of scoreRows) {
    const season = leagueSeasonMap.get(s.leagueId);
    if (!season) continue;
    const key = `${season}|${s.week}`;
    if (!activeKeys.has(key)) continue;
    const pts = s.points ?? 0;
    totalPoints += pts;
    if (s.isStarter) {
      starterWeeks += 1;
      starterPoints += pts;
    }
  }

  const weeksActive = activeKeys.size;
  return {
    ppg: weeksActive > 0 ? totalPoints / weeksActive : null,
    ppgStarting: starterWeeks > 0 ? starterPoints / starterWeeks : null,
    startPct: weeksActive > 0 ? starterWeeks / weeksActive : null,
    activePct: weeksAvailable > 0 ? weeksActive / weeksAvailable : null,
    weeksAvailable,
    weeksActive,
    starterWeeks,
    totalPoints,
    starterPoints,
    byeWeeksExcluded: byeKeys.size,
  };
}

function emptyStats(): StintStats {
  return {
    ppg: null,
    ppgStarting: null,
    startPct: null,
    activePct: null,
    weeksAvailable: 0,
    weeksActive: 0,
    starterWeeks: 0,
    totalPoints: 0,
    starterPoints: 0,
    byeWeeksExcluded: 0,
  };
}

function isInWindow(
  season: string,
  week: number,
  startSeason: string,
  startWeek: number,
  endSeason: string | null | undefined,
  endWeek: number | null | undefined,
): boolean {
  const s = parseInt(season, 10);
  const ss = parseInt(startSeason, 10);
  if (s < ss) return false;
  if (s === ss && week < startWeek) return false;
  if (endSeason == null) return true; // ongoing
  const es = parseInt(endSeason, 10);
  if (s > es) return false;
  if (s === es && endWeek != null && week > endWeek) return false;
  return true;
}
