import { getDb, schema } from "@/db";
import { eq, and, inArray } from "drizzle-orm";
import type { SleeperBracketMatchup } from "@/lib/sleeper";

// ============================================================
// Grade Configuration
// ============================================================

export const GRADE_CONFIG = {
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
// ============================================================

export const VALUE_FLOOR = 300;

/** Standard NFL season length. Used as default for availability calculations. */
export const NFL_SEASON_WEEKS = 18;

export function effectiveValue(raw: number): number {
  return Math.max(0, raw - VALUE_FLOOR);
}

// ============================================================
// Rank-based production curve (v1 — retained for experiment comparison)
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
  totalWeeks: number = NFL_SEASON_WEEKS,
): number {
  const maxRank = RANK_FLOOR[position];
  if (maxRank && rank > maxRank) return 0;

  const rankValue = 100 * Math.exp(-RANK_DECAY * (rank - 1));
  const availability = Math.min(1, activeWeeks / totalWeeks);
  return rankValue * availability;
}

// ============================================================
// Points-Above-Replacement (v2)
// ============================================================

/** Replacement-level rank cutoffs for standard leagues */
const REPLACEMENT_RANK: Record<string, number> = {
  QB: 12,
  RB: 24,
  WR: 36,
  TE: 12,
};

/** Replacement-level rank cutoffs for superflex leagues */
const REPLACEMENT_RANK_SF: Record<string, number> = {
  QB: 24,
  RB: 24,
  WR: 36,
  TE: 12,
};

export function getReplacementRank(
  position: string,
  isSuperFlex: boolean,
): number {
  const table = isSuperFlex ? REPLACEMENT_RANK_SF : REPLACEMENT_RANK;
  return table[position] ?? 12;
}

/**
 * Points-above-replacement for a single value.
 * Returns 0 for at-or-below replacement, positive for above.
 */
export function pointsAboveReplacement(
  ppg: number,
  replacementPPG: number,
): number {
  return Math.max(0, ppg - replacementPPG);
}

/**
 * Scale a PAR value to 0-100 using the max PAR at the position.
 * If maxPAR is 0 or unavailable, returns 0.
 */
export function scaledPAR(par: number, maxPAR: number): number {
  if (maxPAR <= 0) return 0;
  return Math.min(100, (par / maxPAR) * 100);
}

// ============================================================
// Context-Specific Blend Profiles
// ============================================================

export type BlendContext = "trade" | "draft" | "waiver";

interface BlendBreakpoint {
  weeks: number;
  weight: number;
}

/**
 * Blend profiles define how production weight ramps over time.
 * Each profile is an array of breakpoints; we linearly interpolate between them.
 * Weight = proportion of production in the blended score (remainder = value).
 */
const BLEND_PROFILES: Record<BlendContext, BlendBreakpoint[]> = {
  trade: [
    { weeks: 0, weight: 0 },
    { weeks: 2, weight: 0 },
    { weeks: 8, weight: 0.3 },
    { weeks: 52, weight: 0.7 },
    { weeks: 156, weight: 0.85 },
    { weeks: 260, weight: 0.95 },
  ],
  draft: [
    { weeks: 0, weight: 0 },
    { weeks: 8, weight: 0 },
    { weeks: 52, weight: 0.5 },
    { weeks: 156, weight: 0.85 },
    { weeks: 260, weight: 0.95 },
  ],
  waiver: [
    { weeks: 0, weight: 0.2 },
    { weeks: 2, weight: 0.2 },
    { weeks: 8, weight: 0.6 },
    { weeks: 52, weight: 0.9 },
    { weeks: 260, weight: 0.95 },
  ],
};

export function productionWeight(
  weeksElapsed: number,
  context: BlendContext = "trade",
): number {
  const profile = BLEND_PROFILES[context];
  if (weeksElapsed <= 0) return profile[0].weight;

  for (let i = 1; i < profile.length; i++) {
    if (weeksElapsed <= profile[i].weeks) {
      const prev = profile[i - 1];
      const curr = profile[i];
      const t = (weeksElapsed - prev.weeks) / (curr.weeks - prev.weeks);
      return prev.weight + t * (curr.weight - prev.weight);
    }
  }

  return profile[profile.length - 1].weight;
}

// ============================================================
// Production Layers (v2)
// ============================================================

/** Floor PAR fraction for below-replacement starters (scales with position replacement PPG). */
export const BELOW_REPLACEMENT_FLOOR = 0.15;

/**
 * Starter utilization multiplier.
 * - Started + optimal (above replacement): 1.0x — full credit
 * - Started + below replacement: 0.7x — trusted but unlucky (applied to floor PAR)
 * - Benched + would have improved lineup: 0.3x — opportunity cost
 * - Benched + correctly benched: 0x — short-circuited before reaching here
 *
 * All four branches are reachable because callers use a floor PAR
 * (replacementPPG * BELOW_REPLACEMENT_FLOOR) for below-replacement weeks
 * instead of skipping them entirely.
 */
export function starterMultiplier(
  isStarter: boolean,
  isOptimal: boolean,
): number {
  if (isStarter && isOptimal) return 1.0;
  if (isStarter && !isOptimal) return 0.7;
  if (!isStarter && isOptimal) return 0.3;
  return 0;
}

/**
 * Matchup outcome multiplier.
 * - Started in a win: 1.2x
 * - Started in a close loss (margin < contribution): 1.0x
 * - Started in a blowout loss: 0.8x
 * - Not started or no matchup data: 1.0x (neutral)
 */
export function matchupOutcomeMultiplier(
  started: boolean,
  won: boolean | null,
  margin: number | null,
  contribution: number | null,
): number {
  if (!started || won === null) return 1.0;
  if (won) return 1.2;
  if (
    margin !== null &&
    contribution !== null &&
    Math.abs(margin) < contribution
  ) {
    return 1.0;
  }
  return 0.8;
}

/**
 * Playoff week weighting multiplier.
 * - Regular season: 1.0x
 * - Playoff weeks (winners bracket): 1.5x
 * - Championship week (winners bracket): 2.0x
 * - Consolation bracket: 1.0x (no boost)
 *
 * When playoffRosterIds/rosterId are null, falls through to boost-all behavior
 * for graceful degradation when bracket data is unavailable.
 */
export function playoffWeightMultiplier(
  week: number,
  playoffStart: number | null,
  championshipWeek: number | null = null,
  playoffRosterIds: Set<number> | null = null,
  rosterId: number | null = null,
): number {
  if (playoffStart === null || week < playoffStart) return 1.0;

  // If bracket data available, only boost winners-bracket teams
  if (playoffRosterIds !== null && rosterId !== null) {
    if (!playoffRosterIds.has(rosterId)) return 1.0;
  }

  if (championshipWeek !== null && week >= championshipWeek) return 2.0;
  return 1.5;
}

// ============================================================
// Composite key helpers (centralize format to avoid typos)
// ============================================================

export function seasonPositionKey(season: string | number, position: string): string {
  return `${season}:${position}`;
}

export function matchupKey(leagueId: string, week: number, rosterId: number): string {
  return `${leagueId}:${week}:${rosterId}`;
}

// ============================================================
// Utility
// ============================================================

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

/** Normalize a diff into a 0-100 score centered at 50 */
export function normalizeScore(diff: number, scaling: number): number {
  return clamp(50 + clamp(diff / scaling, -1, 1) * 50, 0, 100);
}

/**
 * Normalize an array of raw values to 0-100 using min-max scaling.
 * Used to convert raw total production into a league-relative score
 * for the "quantity" dimension of quality x quantity grading.
 *
 * Returns a Map from the original index to the normalized score.
 * When all values are equal, returns 50 for everyone.
 */
export function normalizeWithinLeague(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return values.map(() => 50);
  return values.map((v) => clamp(((v - min) / range) * 100, 0, 100));
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
// Types
// ============================================================

export interface SeasonalData {
  ranks: Map<string, Map<string, number>>; // "season:position" -> playerId -> rank
  games: Map<string, Map<string, number>>; // "season" -> playerId -> gamesPlayed
  activeWeeks: Map<string, Map<string, number>>; // "season" -> playerId -> activeWeekCount
  positions: Map<string, string>; // playerId -> position
  replacementPPG: Map<string, number>; // "season:position" -> replacement-level PPG
  playerPPG: Map<string, Map<string, number>>; // "season:position" -> playerId -> PPG
  maxPAR: Map<string, number>; // "season:position" -> max PAR for scaling
}

export interface PlayerWeekData {
  week: number;
  rosterId: number;
  points: number;
  isStarter: boolean;
}

export interface MatchupResult {
  won: boolean;
  margin: number;
  opponentRosterId: number;
}

export interface PlayoffConfig {
  playoffStart: number;
  championshipWeek: number;
  winnersBracketRosterIds?: Set<number>;
}

/**
 * Extract all roster IDs that appear in the winners bracket.
 * Works with the raw Sleeper bracket response shape.
 */
export function extractBracketRosterIds(
  bracket: SleeperBracketMatchup[],
): Set<number> {
  const ids = new Set<number>();
  for (const m of bracket) {
    if (typeof m.t1 === "number") ids.add(m.t1);
    if (typeof m.t2 === "number") ids.add(m.t2);
    if (m.w !== null) ids.add(m.w);
    if (m.l !== null) ids.add(m.l);
  }
  return ids;
}

// ============================================================
// Production scoring — PAR-based (v2)
// ============================================================

/**
 * Compute seasonal PAR-based production for a player.
 * Used by draft grading where per-week layers aren't needed.
 * Replaces v1 rank-based exponential decay with direct PPG comparison.
 */
export function playerSeasonalPAR(
  playerId: string,
  startSeason: number,
  endSeason: number,
  seasonalData: SeasonalData,
): number {
  const position = seasonalData.positions.get(playerId);
  if (!position) return 0;

  let total = 0;

  for (let season = startSeason; season <= endSeason; season++) {
    const key = seasonPositionKey(season, position);
    const ppgMap = seasonalData.playerPPG.get(key);
    const repPPG = seasonalData.replacementPPG.get(key);
    const maxPARVal = seasonalData.maxPAR.get(key);
    const awMap = seasonalData.activeWeeks.get(String(season));

    if (!ppgMap || repPPG === undefined || !maxPARVal) continue;

    const ppg = ppgMap.get(playerId);
    if (ppg === undefined) continue;

    const par = pointsAboveReplacement(ppg, repPPG);
    const scaled = scaledPAR(par, maxPARVal);
    const activeWeekCount = awMap?.get(playerId) ?? 0;
    const availability = Math.min(1, activeWeekCount / NFL_SEASON_WEEKS);
    total += scaled * availability;
  }

  return total;
}

/**
 * Compute per-week layered production for a player within a roster ownership window.
 * Used by trade grading where production should be roster-scoped with all layers.
 *
 * Returns a 0-100 score. Normalizes by dividing the layer-adjusted PAR sum
 * by actual weeks used, then scaling against maxPAR.
 */
export function playerLayeredProduction(
  weeklyScores: PlayerWeekData[],
  replacementPPG: number,
  maxPAR: number,
  opts: {
    fromWeek?: number;
    toWeek?: number;
    rosterId?: number;
    matchupOutcomes?: Map<string, MatchupResult>;
    playoffStart?: number | null;
    championshipWeek?: number | null;
    playoffRosterIds?: Set<number> | null;
    leagueId?: string;
  } = {},
): { production: number; weeksUsed: number; rawTotalPAR: number } {
  const {
    fromWeek,
    toWeek,
    rosterId,
    matchupOutcomes,
    playoffStart = null,
    championshipWeek = null,
    playoffRosterIds = null,
    leagueId,
  } = opts;

  let totalLayeredPAR = 0;
  let weeksUsed = 0;

  for (const ws of weeklyScores) {
    if (rosterId !== undefined && ws.rosterId !== rosterId) continue;
    if (fromWeek !== undefined && ws.week < fromWeek) continue;
    if (toWeek !== undefined && ws.week > toWeek) continue;

    weeksUsed++;

    const rawPAR = pointsAboveReplacement(ws.points, replacementPPG);

    // Layer 2: Starter utilization
    const isOptimal = rawPAR > 0;
    const sMult = starterMultiplier(ws.isStarter, isOptimal);

    // Short-circuit: benched + below replacement (sMult === 0) contributes nothing
    if (sMult === 0) continue;

    // For below-replacement starters, use a floor PAR so the 0.7x branch has effect
    const effectivePAR = isOptimal ? rawPAR : replacementPPG * BELOW_REPLACEMENT_FLOOR;

    // Layer 3: Matchup outcome
    let mMult = 1.0;
    if (matchupOutcomes && leagueId) {
      const mKey = matchupKey(leagueId, ws.week, ws.rosterId);
      const outcome = matchupOutcomes.get(mKey);
      if (outcome) {
        mMult = matchupOutcomeMultiplier(
          ws.isStarter,
          outcome.won,
          outcome.margin,
          ws.points,
        );
      }
    }

    // Layer 4: Playoff weighting (consolation bracket filtered out when bracket data available)
    const pMult = playoffWeightMultiplier(ws.week, playoffStart, championshipWeek, playoffRosterIds, ws.rosterId);

    totalLayeredPAR += effectivePAR * sMult * mMult * pMult;
  }

  // Normalize: average weekly layered PAR, then scale to 0-100
  const avgWeeklyPAR = weeksUsed > 0 ? totalLayeredPAR / weeksUsed : 0;
  const production = scaledPAR(avgWeeklyPAR, maxPAR);

  return { production, weeksUsed, rawTotalPAR: totalLayeredPAR };
}

/**
 * Backward-compatible wrapper. Delegates to playerSeasonalPAR when
 * full SeasonalData is available, otherwise falls back to v1 rank-based.
 */
export function playerProductionScore(
  playerId: string,
  startSeason: number,
  currentYear: number,
  seasonalRanks: Map<string, Map<string, number>>,
  seasonalActiveWeeks: Map<string, Map<string, number>>,
  playerPositions: Map<string, string>,
  seasonalData?: SeasonalData,
): number {
  if (seasonalData) {
    return playerSeasonalPAR(playerId, startSeason, currentYear, seasonalData);
  }

  // Fallback to v1 rank-based
  const position = playerPositions.get(playerId);
  if (!position) return 0;

  let total = 0;

  for (let season = startSeason; season <= currentYear; season++) {
    const seasonStr = String(season);
    const rankMap = seasonalRanks.get(seasonPositionKey(seasonStr, position));
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
// Seasonal data computation (extended for v2)
// ============================================================

export async function computeSeasonalRanks(
  familyLeagueIds: string[],
  leagueSeasonMap: Map<string, string>,
  opts?: { isSuperFlex?: boolean },
): Promise<SeasonalData> {
  const db = getDb();
  const isSuperFlex = opts?.isSuperFlex ?? false;

  const ranks = new Map<string, Map<string, number>>();
  const games = new Map<string, Map<string, number>>();
  const activeWeeks = new Map<string, Map<string, number>>();
  const positions = new Map<string, string>();
  const replacementPPGMap = new Map<string, number>();
  const playerPPGMap = new Map<string, Map<string, number>>();
  const maxPARMap = new Map<string, number>();

  if (familyLeagueIds.length === 0) {
    return {
      ranks,
      games,
      activeWeeks,
      positions,
      replacementPPG: replacementPPGMap,
      playerPPG: playerPPGMap,
      maxPAR: maxPARMap,
    };
  }

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

  // Group by season -> player -> { totalPoints, weeks set }
  const seasonPlayerStats = new Map<
    string,
    Map<
      string,
      { totalPoints: number; weeks: Set<number>; position: string }
    >
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

  // For each season, compute PPG ranks per position + replacement PPG + player PPG
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
      const key = seasonPositionKey(season, position);

      // Build rank map
      if (!ranks.has(key)) {
        ranks.set(key, new Map());
      }
      const rankMap = ranks.get(key)!;
      for (let i = 0; i < players.length; i++) {
        rankMap.set(players[i].playerId, i + 1);
      }

      // Replacement-level PPG: PPG at the replacement rank cutoff
      const repRank = getReplacementRank(position, isSuperFlex);
      const repIndex = Math.min(repRank - 1, players.length - 1);
      const repPPG =
        repIndex >= 0 && repIndex < players.length
          ? players[repIndex].ppg
          : 0;
      replacementPPGMap.set(key, repPPG);

      // Per-player PPG + max PAR at this position
      const ppgMap = new Map<string, number>();
      let maxPARVal = 0;
      for (const p of players) {
        ppgMap.set(p.playerId, p.ppg);
        const par = pointsAboveReplacement(p.ppg, repPPG);
        maxPARVal = Math.max(maxPARVal, par);
      }
      playerPPGMap.set(key, ppgMap);
      maxPARMap.set(key, maxPARVal > 0 ? maxPARVal : 1); // avoid div-by-zero
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
      ...new Set(
        Array.from(leagueSeasonMap.values()).map((s) => parseInt(s, 10)),
      ),
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
      if (!activeWeeks.has(seasonStr))
        activeWeeks.set(seasonStr, new Map());
      const seasonMap = activeWeeks.get(seasonStr)!;
      seasonMap.set(playerId, (seasonMap.get(playerId) || 0) + 1);
    }
  }

  return {
    ranks,
    games,
    activeWeeks,
    positions,
    replacementPPG: replacementPPGMap,
    playerPPG: playerPPGMap,
    maxPAR: maxPARMap,
  };
}

// ============================================================
// Data-loading helpers for per-week production
// ============================================================

/**
 * Load per-week player scores for all leagues in the family.
 * Returns: leagueId -> playerId -> weekly scores
 */
export async function loadPlayerWeeklyScores(
  familyLeagueIds: string[],
): Promise<Map<string, Map<string, PlayerWeekData[]>>> {
  const db = getDb();
  const result = new Map<string, Map<string, PlayerWeekData[]>>();

  if (familyLeagueIds.length === 0) return result;

  const rows = await db
    .select({
      leagueId: schema.playerScores.leagueId,
      playerId: schema.playerScores.playerId,
      week: schema.playerScores.week,
      rosterId: schema.playerScores.rosterId,
      points: schema.playerScores.points,
      isStarter: schema.playerScores.isStarter,
    })
    .from(schema.playerScores)
    .where(inArray(schema.playerScores.leagueId, familyLeagueIds));

  for (const row of rows) {
    if (!result.has(row.leagueId))
      result.set(row.leagueId, new Map());
    const leagueMap = result.get(row.leagueId)!;
    if (!leagueMap.has(row.playerId))
      leagueMap.set(row.playerId, []);
    leagueMap.get(row.playerId)!.push({
      week: row.week,
      rosterId: row.rosterId,
      points: row.points ?? 0,
      isStarter: row.isStarter ?? false,
    });
  }

  return result;
}

/**
 * Load matchup outcomes for all leagues in the family.
 * Returns: "leagueId:week:rosterId" -> MatchupResult
 */
export async function loadMatchupOutcomes(
  familyLeagueIds: string[],
): Promise<Map<string, MatchupResult>> {
  const db = getDb();
  const result = new Map<string, MatchupResult>();

  if (familyLeagueIds.length === 0) return result;

  const rows = await db
    .select({
      leagueId: schema.matchups.leagueId,
      week: schema.matchups.week,
      rosterId: schema.matchups.rosterId,
      matchupId: schema.matchups.matchupId,
      points: schema.matchups.points,
    })
    .from(schema.matchups)
    .where(inArray(schema.matchups.leagueId, familyLeagueIds));

  // Group by leagueId + week + matchupId to pair opponents
  const pairings = new Map<
    string,
    Array<{ rosterId: number; points: number }>
  >();
  for (const row of rows) {
    if (row.matchupId === null) continue;
    const pairKey = `${row.leagueId}:${row.week}:${row.matchupId}`;
    if (!pairings.has(pairKey)) pairings.set(pairKey, []);
    pairings.get(pairKey)!.push({
      rosterId: row.rosterId,
      points: row.points ?? 0,
    });
  }

  // Resolve W/L for each roster in each matchup
  for (const [pairKey, sides] of pairings) {
    const parts = pairKey.split(":");
    const leagueId = parts[0];
    const week = parseInt(parts[1], 10);
    if (sides.length !== 2) continue; // skip byes

    const [a, b] = sides;
    const margin = a.points - b.points;

    result.set(matchupKey(leagueId, week, a.rosterId), {
      won: margin > 0,
      margin,
      opponentRosterId: b.rosterId,
    });
    result.set(matchupKey(leagueId, week, b.rosterId), {
      won: margin < 0,
      margin: -margin,
      opponentRosterId: a.rosterId,
    });
  }

  return result;
}

/**
 * Load playoff start week for each league.
 * Returns: leagueId -> playoff_week_start
 */
export async function loadPlayoffConfig(
  familyLeagueIds: string[],
): Promise<Map<string, PlayoffConfig>> {
  const db = getDb();
  const result = new Map<string, PlayoffConfig>();

  if (familyLeagueIds.length === 0) return result;

  const rows = await db
    .select({
      id: schema.leagues.id,
      settings: schema.leagues.settings,
      winnersBracket: schema.leagues.winnersBracket,
    })
    .from(schema.leagues)
    .where(inArray(schema.leagues.id, familyLeagueIds));

  for (const row of rows) {
    const settings = row.settings as Record<string, unknown> | null;
    if (settings) {
      const playoffStart = settings.playoff_week_start as number | undefined;
      if (playoffStart) {
        const numPlayoffTeams = (settings.playoff_teams as number) ?? 6;
        const playoffRounds = Math.ceil(Math.log2(Math.max(2, numPlayoffTeams)));
        const championshipWeek = playoffStart + playoffRounds - 1;
        const config: PlayoffConfig = { playoffStart, championshipWeek };

        // Attach winners bracket roster IDs if available
        const bracket = row.winnersBracket as SleeperBracketMatchup[] | null;
        if (bracket && bracket.length > 0) {
          config.winnersBracketRosterIds = extractBracketRosterIds(bracket);
        }

        result.set(row.id, config);
      }
    }
  }

  return result;
}

/**
 * Load roster owner mappings for all leagues in the family.
 * Returns: leagueId -> ownerId -> rosterId
 */
export async function loadLeagueOwnerRosters(
  familyLeagueIds: string[],
): Promise<Map<string, Map<string, number>>> {
  const db = getDb();
  const result = new Map<string, Map<string, number>>();

  if (familyLeagueIds.length === 0) return result;

  const rows = await db
    .select({
      leagueId: schema.rosters.leagueId,
      rosterId: schema.rosters.rosterId,
      ownerId: schema.rosters.ownerId,
    })
    .from(schema.rosters)
    .where(inArray(schema.rosters.leagueId, familyLeagueIds));

  for (const r of rows) {
    if (!r.ownerId) continue;
    if (!result.has(r.leagueId))
      result.set(r.leagueId, new Map());
    result.get(r.leagueId)!.set(r.ownerId, r.rosterId);
  }

  return result;
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

  const scoring = leagueSettings?.scoringSettings as Record<
    string,
    number
  > | null;
  const ppr = scoring?.rec ?? 0.5;
  const rosterPositions =
    (leagueSettings?.rosterPositions as string[]) || [];
  const isSuperFlex = rosterPositions.includes("SUPER_FLEX");

  return { ppr, isSuperFlex };
}

export async function loadFamilyLeagueMap(
  familyId: string,
): Promise<{
  familyLeagueIds: string[];
  leagueSeasonMap: Map<string, string>;
}> {
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
    leagueSeasonMap: new Map(
      familyMembers.map((m) => [m.leagueId, m.season]),
    ),
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
