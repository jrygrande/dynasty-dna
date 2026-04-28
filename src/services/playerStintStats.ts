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
  weeksInWindow: number;
  weeksRostered: number;
  starterWeeks: number;
  totalPoints: number;
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
    for (const r of statusRows) {
      if (r.team) playerTeamByWeek.set(`${r.season}|${r.week}`, r.team);
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
  }

  const weeksInWindow = windowKeys.size - byeKeys.size;

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

  let weeksRostered = 0;
  let starterWeeks = 0;
  let totalPoints = 0;
  let starterPoints = 0;
  for (const s of scoreRows) {
    const season = leagueSeasonMap.get(s.leagueId);
    if (!season) continue;
    const key = `${season}|${s.week}`;
    if (!windowKeys.has(key)) continue;
    if (byeKeys.has(key)) continue;
    weeksRostered += 1;
    const pts = s.points ?? 0;
    totalPoints += pts;
    if (s.isStarter) {
      starterWeeks += 1;
      starterPoints += pts;
    }
  }

  return {
    ppg: weeksRostered > 0 ? totalPoints / weeksRostered : null,
    ppgStarting: starterWeeks > 0 ? starterPoints / starterWeeks : null,
    startPct: weeksRostered > 0 ? starterWeeks / weeksRostered : null,
    activePct: weeksInWindow > 0 ? weeksRostered / weeksInWindow : null,
    weeksInWindow,
    weeksRostered,
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
    weeksInWindow: 0,
    weeksRostered: 0,
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
