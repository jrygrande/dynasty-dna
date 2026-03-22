import { getDb, schema } from "@/db";
import { eq, and, inArray } from "drizzle-orm";

// ============================================================
// Grade Configuration
// ============================================================

export const GRADE_CONFIG = {
  blendCap: 0.9,
  blendHalflife: 0.8,
  valueScaling: 10000,
  productionScaling: 300,
  thresholds: {
    "A+": 72,
    A: 64,
    "B+": 58,
    B: 54,
    C: 44,
    D: 40,
    "D-": 34,
  } as Record<string, number>,
};

// ============================================================
// Value floor (FantasyCalc values already encode non-linearity)
// The VALUE_FLOOR clips noise from low-value assets — analogous to
// the positional RANK_FLOOR below but applied to FantasyCalc values.
// ============================================================

export const VALUE_FLOOR = 300;

export function effectiveValue(raw: number): number {
  return Math.max(0, raw - VALUE_FLOOR);
}

// ============================================================
// Rank-based production curve
// ============================================================

export const RANK_DECAY = 0.08;

/** Players ranked outside the relevant starter pool produce no meaningful signal */
export const RANK_FLOOR: Record<string, number> = {
  QB: 32,
  RB: 30,
  WR: 48,
  TE: 24,
};

export function rankToProductionValue(
  rank: number,
  activeWeeks: number,
  position: string,
  totalWeeks: number = 18,
): number {
  const maxRank = RANK_FLOOR[position];
  if (maxRank && rank > maxRank) return 0;

  const rankValue = 100 * Math.exp(-RANK_DECAY * (rank - 1));
  const availability = Math.min(1, activeWeeks / totalWeeks);
  return rankValue * availability;
}

// ============================================================
// Blend helpers
// ============================================================

export function productionWeight(weeksElapsed: number): number {
  const years = weeksElapsed / 52;
  if (years <= 0) return 0;
  return (
    GRADE_CONFIG.blendCap * years / (years + GRADE_CONFIG.blendHalflife)
  );
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function scoreToGrade(score: number): string {
  const t = GRADE_CONFIG.thresholds;
  if (score >= t["A+"]) return "A+";
  if (score >= t["A"]) return "A";
  if (score >= t["B+"]) return "B+";
  if (score >= t["B"]) return "B";
  if (score >= t["C"]) return "C";
  if (score >= t["D"]) return "D";
  if (score >= t["D-"]) return "D-";
  return "F";
}

/** Normalize a diff into a 0–100 score centered at 50 */
export function normalizeScore(diff: number, scaling: number): number {
  return clamp(50 + clamp(diff / scaling, -1, 1) * 50, 0, 100);
}

/** Compute percentile for a score within a sorted (ascending) array of scores. */
export function computePercentile(
  entry: { score: number },
  sortedAsc: { score: number }[],
): number {
  if (sortedAsc.length <= 1) return 50;
  const rank = sortedAsc.filter((s) => s.score < entry.score).length;
  return Math.round((rank / (sortedAsc.length - 1)) * 1000) / 10;
}

// ============================================================
// Production scoring for a single player
// ============================================================

export interface SeasonalData {
  ranks: Map<string, Map<string, number>>;      // "season:position" → playerId → rank
  games: Map<string, Map<string, number>>;       // "season" → playerId → gamesPlayed
  activeWeeks: Map<string, Map<string, number>>; // "season" → playerId → activeWeekCount
  positions: Map<string, string>;                // playerId → position
}

export function playerProductionScore(
  playerId: string,
  startSeason: number,
  currentYear: number,
  seasonalRanks: Map<string, Map<string, number>>,
  seasonalActiveWeeks: Map<string, Map<string, number>>,
  playerPositions: Map<string, string>,
): number {
  const position = playerPositions.get(playerId);
  if (!position) return 0;

  let total = 0;

  for (let season = startSeason; season <= currentYear; season++) {
    const seasonStr = String(season);
    const rankKey = `${seasonStr}:${position}`;
    const rankMap = seasonalRanks.get(rankKey);
    const awMap = seasonalActiveWeeks.get(seasonStr);

    if (!rankMap) continue;

    const rank = rankMap.get(playerId);
    if (rank === undefined) continue;

    const activeWeekCount = awMap?.get(playerId) ?? 0;
    total += rankToProductionValue(rank, activeWeekCount, position);
  }

  return total;
}

// ============================================================
// Seasonal ranks (pre-computed once per grading run)
// ============================================================

export async function computeSeasonalRanks(
  familyLeagueIds: string[],
  leagueSeasonMap: Map<string, string>,
): Promise<SeasonalData> {
  const db = getDb();
  const ranks = new Map<string, Map<string, number>>();
  const games = new Map<string, Map<string, number>>();
  const activeWeeks = new Map<string, Map<string, number>>();
  const positions = new Map<string, string>();

  if (familyLeagueIds.length === 0) return { ranks, games, activeWeeks, positions };

  const scoreRows = await db
    .select({
      playerId: schema.playerScores.playerId,
      points: schema.playerScores.points,
      week: schema.playerScores.week,
      leagueId: schema.playerScores.leagueId,
      position: schema.players.position,
    })
    .from(schema.playerScores)
    .innerJoin(
      schema.players,
      eq(schema.playerScores.playerId, schema.players.id),
    )
    .where(
      and(
        inArray(schema.playerScores.leagueId, familyLeagueIds),
        inArray(schema.players.position, ["QB", "RB", "WR", "TE"]),
      ),
    );

  // Group by season → player → { totalPoints, weeks set }
  const seasonPlayerStats = new Map<
    string,
    Map<string, { totalPoints: number; weeks: Set<number>; position: string }>
  >();

  for (const row of scoreRows) {
    const season = leagueSeasonMap.get(row.leagueId);
    if (!season || !row.position) continue;

    positions.set(row.playerId, row.position);

    if (!seasonPlayerStats.has(season)) {
      seasonPlayerStats.set(season, new Map());
    }
    const playerMap = seasonPlayerStats.get(season)!;

    if (!playerMap.has(row.playerId)) {
      playerMap.set(row.playerId, {
        totalPoints: 0,
        weeks: new Set(),
        position: row.position,
      });
    }
    const stats = playerMap.get(row.playerId)!;
    stats.totalPoints += row.points || 0;
    stats.weeks.add(row.week);
  }

  // For each season, compute PPG ranks per position + games played
  for (const [season, playerMap] of seasonPlayerStats) {
    if (!games.has(season)) {
      games.set(season, new Map());
    }
    const seasonGames = games.get(season)!;

    const byPosition = new Map<
      string,
      Array<{ playerId: string; ppg: number }>
    >();

    for (const [playerId, stats] of playerMap) {
      const gamesPlayed = stats.weeks.size;
      seasonGames.set(playerId, gamesPlayed);

      if (gamesPlayed < 3) continue;

      const ppg = stats.totalPoints / gamesPlayed;
      if (!byPosition.has(stats.position)) {
        byPosition.set(stats.position, []);
      }
      byPosition.get(stats.position)!.push({ playerId, ppg });
    }

    for (const [position, players] of byPosition) {
      players.sort((a, b) => b.ppg - a.ppg);
      const key = `${season}:${position}`;
      if (!ranks.has(key)) {
        ranks.set(key, new Map());
      }
      const rankMap = ranks.get(key)!;
      for (let i = 0; i < players.length; i++) {
        rankMap.set(players[i].playerId, i + 1);
      }
    }
  }

  // Pre-compute active NFL roster weeks per player per season
  const playerGsisRows = await db
    .select({ id: schema.players.id, gsisId: schema.players.gsisId })
    .from(schema.players)
    .where(inArray(schema.players.position, ["QB", "RB", "WR", "TE"]));

  const gsisToPlayerId = new Map<string, string>();
  for (const row of playerGsisRows) {
    if (row.gsisId) gsisToPlayerId.set(row.gsisId, row.id);
  }

  if (gsisToPlayerId.size > 0) {
    const relevantSeasons = [
      ...new Set(Array.from(leagueSeasonMap.values()).map((s) => parseInt(s, 10))),
    ].filter((s) => !isNaN(s));

    const statusConditions = [
      eq(schema.nflWeeklyRosterStatus.status, "ACT"),
    ];
    if (relevantSeasons.length > 0) {
      statusConditions.push(
        inArray(schema.nflWeeklyRosterStatus.season, relevantSeasons),
      );
    }

    const statusRows = await db
      .select({
        gsisId: schema.nflWeeklyRosterStatus.gsisId,
        season: schema.nflWeeklyRosterStatus.season,
        week: schema.nflWeeklyRosterStatus.week,
      })
      .from(schema.nflWeeklyRosterStatus)
      .where(and(...statusConditions));

    for (const row of statusRows) {
      const playerId = gsisToPlayerId.get(row.gsisId);
      if (!playerId) continue;
      const seasonStr = String(row.season);
      if (!activeWeeks.has(seasonStr)) activeWeeks.set(seasonStr, new Map());
      const seasonMap = activeWeeks.get(seasonStr)!;
      seasonMap.set(playerId, (seasonMap.get(playerId) || 0) + 1);
    }
  }

  return { ranks, games, activeWeeks, positions };
}

// ============================================================
// Shared data-loading helpers
// ============================================================

export async function loadLeagueScoringConfig(
  leagueId: string,
): Promise<{ ppr: number; isSuperFlex: boolean }> {
  const db = getDb();
  const [leagueSettings] = await db
    .select({
      scoringSettings: schema.leagues.scoringSettings,
      rosterPositions: schema.leagues.rosterPositions,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);

  const scoring = leagueSettings?.scoringSettings as Record<string, number> | null;
  const ppr = scoring?.rec ?? 0.5;
  const rosterPositions = (leagueSettings?.rosterPositions as string[]) || [];
  const isSuperFlex = rosterPositions.includes("SUPER_FLEX");

  return { ppr, isSuperFlex };
}

export async function loadFamilyLeagueMap(
  familyId: string,
): Promise<{ familyLeagueIds: string[]; leagueSeasonMap: Map<string, string> }> {
  const db = getDb();
  const familyMembers = await db
    .select({
      leagueId: schema.leagueFamilyMembers.leagueId,
      season: schema.leagueFamilyMembers.season,
    })
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, familyId));

  return {
    familyLeagueIds: familyMembers.map((m) => m.leagueId),
    leagueSeasonMap: new Map(familyMembers.map((m) => [m.leagueId, m.season])),
  };
}

export async function loadFantasyCalcSnapshot(
  isSuperFlex: boolean,
  ppr: number,
): Promise<Map<string, number>> {
  const db = getDb();
  const snapshotRows = await db
    .select({
      playerId: schema.fantasyCalcValues.playerId,
      value: schema.fantasyCalcValues.value,
    })
    .from(schema.fantasyCalcValues)
    .where(
      and(
        eq(schema.fantasyCalcValues.isSuperFlex, isSuperFlex),
        eq(schema.fantasyCalcValues.ppr, ppr),
      ),
    );

  const snapshot = new Map<string, number>();
  for (const row of snapshotRows) {
    snapshot.set(row.playerId, effectiveValue(row.value));
  }
  return snapshot;
}
