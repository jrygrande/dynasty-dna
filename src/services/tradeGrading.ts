import { getDb, schema } from "@/db";
import { eq, and, inArray } from "drizzle-orm";
import { syncFantasyCalcValues } from "@/services/fantasyCalcSync";

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
// ============================================================

const VALUE_FLOOR = 300;

export function effectiveValue(raw: number): number {
  return Math.max(0, raw - VALUE_FLOOR);
}

// ============================================================
// Rank-based production curve
// ============================================================

const RANK_DECAY = 0.08;

export function rankToProductionValue(
  rank: number,
  gamesPlayed: number,
  totalWeeks: number = 18,
): number {
  const rankValue = 100 * Math.exp(-RANK_DECAY * (rank - 1));
  const availability = Math.min(1, gamesPlayed / totalWeeks);
  return rankValue * availability;
}

// ============================================================
// Draft pick resolution
// ============================================================

export interface PickResolution {
  value: number;
  resolved: "player" | "round-avg" | "missing";
  playerId?: string;
}

export function resolvePickValue(
  pick: { season: string; round: number; roster_id: number },
  drafts: Map<
    string,
    {
      slotToRosterId: Record<string, number> | null;
      draftId: string;
      status: string;
      type: string;
      totalRosters: number;
    }
  >,
  draftPicks: Map<string, Map<number, string>>,
  playerSnapshot: Map<string, number>,
  roundAverages: Map<number, number>,
): PickResolution {
  const draftInfo = drafts.get(pick.season);

  if (
    draftInfo &&
    draftInfo.status === "complete" &&
    draftInfo.slotToRosterId
  ) {
    const slotMap = draftInfo.slotToRosterId;
    const teams = draftInfo.totalRosters;
    const isSnake = draftInfo.type === "snake";

    let originalSlot: number | null = null;
    for (const [slot, rosterId] of Object.entries(slotMap)) {
      if (rosterId === pick.roster_id) {
        originalSlot = parseInt(slot, 10);
        break;
      }
    }

    if (originalSlot !== null) {
      let pickNo: number;
      if (isSnake && pick.round % 2 === 0) {
        pickNo = (pick.round - 1) * teams + (teams + 1 - originalSlot);
      } else {
        pickNo = (pick.round - 1) * teams + originalSlot;
      }

      const picksForDraft = draftPicks.get(draftInfo.draftId);
      const playerId = picksForDraft?.get(pickNo);

      if (playerId) {
        const value = playerSnapshot.get(playerId);
        if (value !== undefined) {
          return { value, resolved: "player", playerId };
        }
      }
    }
  }

  const avgValue = roundAverages.get(pick.round);
  if (avgValue !== undefined) {
    return { value: avgValue, resolved: "round-avg" };
  }

  return { value: 0, resolved: "missing" };
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

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function scoreToGrade(score: number): string {
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

// ============================================================
// Value scoring (FantasyCalc + non-linear curve)
// ============================================================

interface ValueResult {
  valueScore: number;
  rawValue: number;
}

export function computeValueScores(
  trade: {
    adds: Record<string, number>;
    drops: Record<string, number>;
    draftPicks: Array<{
      season: string;
      round: number;
      roster_id: number;
      previous_owner_id: number;
      owner_id: number;
    }>;
    rosterIds: number[];
  },
  snapshot: Map<string, number>,
  pickResolver?: (pick: {
    season: string;
    round: number;
    roster_id: number;
  }) => PickResolution,
): Map<number, ValueResult> {
  const results = new Map<number, ValueResult>();

  for (const rosterId of trade.rosterIds) {
    let valueReceived = 0;
    for (const [playerId, addedToRoster] of Object.entries(trade.adds)) {
      if (addedToRoster === rosterId) {
        valueReceived += snapshot.get(playerId) || 0;
      }
    }

    for (const dp of trade.draftPicks) {
      if (dp.owner_id === rosterId) {
        if (pickResolver) {
          const result = pickResolver({
            season: dp.season,
            round: dp.round,
            roster_id: dp.roster_id,
          });
          valueReceived += result.value;
        } else {
          const pickKey = `FP_${dp.season}_${dp.round}`;
          valueReceived += snapshot.get(pickKey) || 0;
        }
      }
    }

    let valueSent = 0;
    for (const [playerId, droppedFromRoster] of Object.entries(trade.drops)) {
      if (droppedFromRoster === rosterId) {
        valueSent += snapshot.get(playerId) || 0;
      }
    }

    for (const dp of trade.draftPicks) {
      if (dp.previous_owner_id === rosterId) {
        if (pickResolver) {
          const result = pickResolver({
            season: dp.season,
            round: dp.round,
            roster_id: dp.roster_id,
          });
          valueSent += result.value;
        } else {
          const pickKey = `FP_${dp.season}_${dp.round}`;
          valueSent += snapshot.get(pickKey) || 0;
        }
      }
    }

    const diff = valueReceived - valueSent;
    const valueScore =
      50 + clamp(diff / GRADE_CONFIG.valueScaling, -1, 1) * 50;

    results.set(rosterId, {
      valueScore: clamp(valueScore, 0, 100),
      rawValue: valueReceived,
    });
  }

  return results;
}

// ============================================================
// Seasonal ranks (pre-computed once per grading run)
// ============================================================

export async function computeSeasonalRanks(
  familyLeagueIds: string[],
  leagueSeasonMap: Map<string, string>,
): Promise<{
  ranks: Map<string, Map<string, number>>; // "season:position" → (playerId → rank)
  games: Map<string, Map<string, number>>; // "season" → (playerId → gamesPlayed)
  positions: Map<string, string>; // playerId → position
}> {
  const db = getDb();
  const ranks = new Map<string, Map<string, number>>();
  const games = new Map<string, Map<string, number>>();
  const positions = new Map<string, string>();

  if (familyLeagueIds.length === 0) return { ranks, games, positions };

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
    // Build games map for this season
    if (!games.has(season)) {
      games.set(season, new Map());
    }
    const seasonGames = games.get(season)!;

    // Group by position for ranking
    const byPosition = new Map<
      string,
      Array<{ playerId: string; ppg: number }>
    >();

    for (const [playerId, stats] of playerMap) {
      const gamesPlayed = stats.weeks.size;
      seasonGames.set(playerId, gamesPlayed);

      // Filter to players with >= 3 scored weeks
      if (gamesPlayed < 3) continue;

      const ppg = stats.totalPoints / gamesPlayed;
      if (!byPosition.has(stats.position)) {
        byPosition.set(stats.position, []);
      }
      byPosition.get(stats.position)!.push({ playerId, ppg });
    }

    // Rank by PPG within position
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

  return { ranks, games, positions };
}

// ============================================================
// Production scoring (delta-based, rank-based)
// ============================================================

interface ProductionResult {
  productionScore: number;
  weeksUsed: number;
}

type PickResolver = (pick: {
  season: string;
  round: number;
  roster_id: number;
}) => PickResolution;

function playerProductionScore(
  playerId: string,
  tradeSeason: number,
  currentYear: number,
  seasonalRanks: Map<string, Map<string, number>>,
  seasonalGames: Map<string, Map<string, number>>,
  playerPositions: Map<string, string>,
): number {
  const position = playerPositions.get(playerId);
  if (!position) return 0;

  let total = 0;

  // Sum across all post-trade seasons
  for (let season = tradeSeason; season <= currentYear; season++) {
    const seasonStr = String(season);
    const rankKey = `${seasonStr}:${position}`;
    const rankMap = seasonalRanks.get(rankKey);
    const gamesMap = seasonalGames.get(seasonStr);

    if (!rankMap || !gamesMap) continue;

    const rank = rankMap.get(playerId);
    const gamesPlayed = gamesMap.get(playerId);

    if (rank === undefined || gamesPlayed === undefined) continue;

    total += rankToProductionValue(rank, gamesPlayed);
  }

  return total;
}

export function computeProductionScores(
  trade: {
    adds: Record<string, number>;
    drops: Record<string, number>;
    draftPicks?: Array<{
      season: string;
      round: number;
      roster_id: number;
      owner_id: number;
      previous_owner_id: number;
    }>;
    rosterIds: number[];
    createdAt: number;
    leagueId: string;
  },
  seasonalRanks: Map<string, Map<string, number>>,
  seasonalGames: Map<string, Map<string, number>>,
  playerPositions: Map<string, string>,
  pickResolver?: PickResolver,
): Map<number, ProductionResult> {
  const results = new Map<number, ProductionResult>();
  const tradeDate = new Date(trade.createdAt);
  const tradeYear = tradeDate.getFullYear();
  const tradeSeason = tradeDate.getMonth() < 3 ? tradeYear - 1 : tradeYear;
  const currentYear = new Date().getFullYear();

  // Resolve draft pick players for production scoring
  const pickReceivedPlayers = new Map<number, string[]>(); // rosterId → playerIds received via picks
  const pickSentPlayers = new Map<number, string[]>(); // rosterId → playerIds sent via picks
  if (pickResolver && trade.draftPicks) {
    for (const dp of trade.draftPicks) {
      const resolution = pickResolver({
        season: dp.season,
        round: dp.round,
        roster_id: dp.roster_id,
      });
      if (resolution.resolved === "player" && resolution.playerId) {
        // owner_id received this pick's player
        const received = pickReceivedPlayers.get(dp.owner_id) || [];
        received.push(resolution.playerId);
        pickReceivedPlayers.set(dp.owner_id, received);
        // previous_owner_id sent this pick's player
        const sent = pickSentPlayers.get(dp.previous_owner_id) || [];
        sent.push(resolution.playerId);
        pickSentPlayers.set(dp.previous_owner_id, sent);
      }
    }
  }

  for (const rosterId of trade.rosterIds) {
    // Players received
    const receivedPlayerIds = Object.entries(trade.adds)
      .filter(([, rid]) => rid === rosterId)
      .map(([pid]) => pid);
    receivedPlayerIds.push(...(pickReceivedPlayers.get(rosterId) || []));

    // Players sent
    const sentPlayerIds = Object.entries(trade.drops)
      .filter(([, rid]) => rid === rosterId)
      .map(([pid]) => pid);
    sentPlayerIds.push(...(pickSentPlayers.get(rosterId) || []));

    let productionReceived = 0;
    let weeksUsed = 0;
    for (const playerId of receivedPlayerIds) {
      const score = playerProductionScore(
        playerId,
        tradeSeason,
        currentYear,
        seasonalRanks,
        seasonalGames,
        playerPositions,
      );
      productionReceived += score;
      if (score > 0) weeksUsed++;
    }

    let productionSent = 0;
    for (const playerId of sentPlayerIds) {
      productionSent += playerProductionScore(
        playerId,
        tradeSeason,
        currentYear,
        seasonalRanks,
        seasonalGames,
        playerPositions,
      );
    }

    const delta = productionReceived - productionSent;
    const productionScore =
      50 + clamp(delta / GRADE_CONFIG.productionScaling, -1, 1) * 50;

    results.set(rosterId, {
      productionScore: clamp(productionScore, 0, 100),
      weeksUsed,
    });
  }

  return results;
}

// ============================================================
// Blending and grading
// ============================================================

export async function gradeLeagueTrades(
  leagueId: string,
  familyId: string,
): Promise<number> {
  const db = getDb();

  // Ensure fresh superflex-aware FantasyCalc values
  const syncedAt = await syncFantasyCalcValues(leagueId, { force: true });
  if (!syncedAt) {
    console.warn("[tradeGrading] Failed to sync FantasyCalc values");
    return 0;
  }

  // Get all family league IDs and their seasons
  const familyMembers = await db
    .select({
      leagueId: schema.leagueFamilyMembers.leagueId,
      season: schema.leagueFamilyMembers.season,
    })
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, familyId));

  const familyLeagueIds = familyMembers.map((m) => m.leagueId);
  if (familyLeagueIds.length === 0) return 0;

  const leagueSeasonMap = new Map<string, string>(
    familyMembers.map((m) => [m.leagueId, m.season]),
  );

  // Use the snapshot from the sync we just performed
  const snapshotRows = await db
    .select({
      playerId: schema.fantasyCalcValues.playerId,
      value: schema.fantasyCalcValues.value,
    })
    .from(schema.fantasyCalcValues)
    .where(eq(schema.fantasyCalcValues.fetchedAt, syncedAt));

  const snapshot = new Map<string, number>();
  for (const row of snapshotRows) {
    snapshot.set(row.playerId, effectiveValue(row.value));
  }

  // Load drafts with slotToRosterId for pick resolution
  const familyDrafts = await db
    .select({
      id: schema.drafts.id,
      season: schema.drafts.season,
      status: schema.drafts.status,
      type: schema.drafts.type,
      slotToRosterId: schema.drafts.slotToRosterId,
      leagueId: schema.drafts.leagueId,
    })
    .from(schema.drafts)
    .where(inArray(schema.drafts.leagueId, familyLeagueIds));

  const leagueRosterCounts = await db
    .select({
      id: schema.leagues.id,
      totalRosters: schema.leagues.totalRosters,
    })
    .from(schema.leagues)
    .where(inArray(schema.leagues.id, familyLeagueIds));

  const rosterCountMap = new Map(
    leagueRosterCounts.map((l) => [l.id, l.totalRosters || 12]),
  );

  const draftsBySeason = new Map<
    string,
    {
      slotToRosterId: Record<string, number> | null;
      draftId: string;
      status: string;
      type: string;
      totalRosters: number;
    }
  >();
  for (const d of familyDrafts) {
    draftsBySeason.set(d.season, {
      slotToRosterId: d.slotToRosterId as Record<string, number> | null,
      draftId: d.id,
      status: d.status || "",
      type: d.type || "snake",
      totalRosters: rosterCountMap.get(d.leagueId) || 12,
    });
  }

  const completedDraftIds = familyDrafts
    .filter((d) => d.status === "complete")
    .map((d) => d.id);

  const allDraftPicks =
    completedDraftIds.length > 0
      ? await db
          .select({
            draftId: schema.draftPicks.draftId,
            pickNo: schema.draftPicks.pickNo,
            playerId: schema.draftPicks.playerId,
          })
          .from(schema.draftPicks)
          .where(inArray(schema.draftPicks.draftId, completedDraftIds))
      : [];

  const draftPicksMap = new Map<string, Map<number, string>>();
  for (const dp of allDraftPicks) {
    if (!dp.playerId) continue;
    if (!draftPicksMap.has(dp.draftId)) {
      draftPicksMap.set(dp.draftId, new Map());
    }
    draftPicksMap.get(dp.draftId)!.set(dp.pickNo, dp.playerId);
  }

  // Compute round averages from FantasyCalc PICK entries
  const roundAverages = new Map<number, number>();
  const pickValRows = await db
    .select({
      playerName: schema.fantasyCalcValues.playerName,
      value: schema.fantasyCalcValues.value,
    })
    .from(schema.fantasyCalcValues)
    .where(
      and(
        eq(schema.fantasyCalcValues.fetchedAt, syncedAt),
        eq(schema.fantasyCalcValues.position, "PICK"),
      ),
    );

  if (pickValRows.length > 0) {
    const roundGroups = new Map<number, number[]>();
    for (const row of pickValRows) {
      const name = row.playerName || "";
      let round: number | null = null;
      if (name.includes("1st")) round = 1;
      else if (name.includes("2nd")) round = 2;
      else if (name.includes("3rd")) round = 3;
      else if (name.includes("4th")) round = 4;
      else {
        const match = name.match(/(\d+)\.(\d+)/);
        if (match) round = parseInt(match[1], 10);
      }
      if (round !== null) {
        if (!roundGroups.has(round)) roundGroups.set(round, []);
        roundGroups.get(round)!.push(row.value);
      }
    }
    for (const [round, values] of roundGroups) {
      roundAverages.set(
        round,
        values.reduce((a, b) => a + b, 0) / values.length,
      );
    }
  }

  if (roundAverages.size === 0) {
    roundAverages.set(1, 6000);
    roundAverages.set(2, 2500);
    roundAverages.set(3, 1000);
    roundAverages.set(4, 250);
  }

  const pickResolver = (pick: {
    season: string;
    round: number;
    roster_id: number;
  }) =>
    resolvePickValue(
      pick,
      draftsBySeason,
      draftPicksMap,
      snapshot,
      roundAverages,
    );

  // Pre-compute seasonal ranks once for all trades (also returns player positions)
  const { ranks: seasonalRanks, games: seasonalGames, positions: playerPositions } =
    await computeSeasonalRanks(familyLeagueIds, leagueSeasonMap);

  // Get all trade transactions for this league
  const trades = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.leagueId, leagueId),
        eq(schema.transactions.type, "trade"),
      ),
    );

  let graded = 0;

  for (const trade of trades) {
    const adds = (trade.adds || {}) as Record<string, number>;
    const drops = (trade.drops || {}) as Record<string, number>;
    const draftPicks = (trade.draftPicks || []) as Array<{
      season: string;
      round: number;
      roster_id: number;
      previous_owner_id: number;
      owner_id: number;
    }>;
    const rosterIds = (trade.rosterIds || []) as number[];

    if (rosterIds.length === 0) continue;

    const tradeTimestamp = trade.createdAt || Date.now();
    const weeksElapsed = Math.floor(
      (Date.now() - tradeTimestamp) / (7 * 24 * 60 * 60 * 1000),
    );
    const pw = productionWeight(weeksElapsed);

    // Value scores
    const valueScores = computeValueScores(
      { adds, drops, draftPicks, rosterIds },
      snapshot,
      pickResolver,
    );

    // Production scores (skip for very recent trades)
    let productionScores: Map<number, ProductionResult> | null = null;
    if (weeksElapsed > 0) {
      try {
        productionScores = computeProductionScores(
          {
            adds,
            drops,
            draftPicks,
            rosterIds,
            createdAt: tradeTimestamp,
            leagueId: trade.leagueId,
          },
          seasonalRanks,
          seasonalGames,
          playerPositions,
          pickResolver,
        );
      } catch (e) {
        console.warn(
          `[tradeGrading] Production scoring failed for tx ${trade.id}:`,
          e,
        );
      }
    }

    // Blend and upsert for each side
    for (const rosterId of rosterIds) {
      const vs = valueScores.get(rosterId);
      const ps = productionScores?.get(rosterId);

      const valueScore = vs?.valueScore ?? 50;
      const rawValue = vs?.rawValue ?? 0;
      const prodScore = ps?.productionScore ?? 50;
      const weeksUsed = ps?.weeksUsed ?? 0;

      const blendedScore = (1 - pw) * valueScore + pw * prodScore;
      const grade = scoreToGrade(blendedScore);

      await db
        .insert(schema.tradeGrades)
        .values({
          transactionId: trade.id,
          rosterId,
          valueScore,
          fantasyCalcValue: rawValue,
          productionScore: weeksUsed > 0 ? prodScore : null,
          productionWeeks: weeksUsed > 0 ? weeksUsed : null,
          blendedScore,
          productionWeight: pw,
          grade,
          computedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            schema.tradeGrades.transactionId,
            schema.tradeGrades.rosterId,
          ],
          set: {
            valueScore,
            fantasyCalcValue: rawValue,
            productionScore: weeksUsed > 0 ? prodScore : null,
            productionWeeks: weeksUsed > 0 ? weeksUsed : null,
            blendedScore,
            productionWeight: pw,
            grade,
            computedAt: new Date(),
          },
        });

      graded++;
    }
  }

  console.log(
    `[tradeGrading] Graded ${graded} trade sides for league ${leagueId}`,
  );
  return graded;
}
