import { getDb, schema } from "@/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { syncFantasyCalcValues } from "@/services/fantasyCalcSync";
import {
  findOriginalSlot,
  calculatePickNumber,
  resolveDraftPicks,
} from "@/lib/draft";
import {
  GRADE_CONFIG,
  productionWeight,
  scoreToGrade,
  normalizeScore,
  playerLayeredProduction,
  computeSeasonalRanks,
  seasonPositionKey,
  loadLeagueScoringConfig,
  loadFamilyLeagueMap,
  loadFantasyCalcSnapshot,
  loadPlayerWeeklyScores,
  loadMatchupOutcomes,
  loadPlayoffConfig,
  loadLeagueOwnerRosters,
  type SeasonalData,
  type PlayerWeekData,
  type MatchupResult,
  type PlayoffConfig,
} from "@/services/gradingCore";

// ============================================================
// Draft pick resolution
// ============================================================

/** Fallback pick values when FantasyCalc has no PICK entries */
export const DEFAULT_ROUND_AVERAGES: Record<number, number> = {
  1: 6000,
  2: 2500,
  3: 1000,
  4: 250,
};

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

    const originalSlot = findOriginalSlot(slotMap, pick.roster_id);

    if (originalSlot !== null) {
      const pickNo = calculatePickNumber(
        pick.round,
        originalSlot,
        teams,
        isSnake,
      );

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
    for (const [playerId, droppedFromRoster] of Object.entries(
      trade.drops,
    )) {
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
    const valueScore = normalizeScore(diff, GRADE_CONFIG.valueScaling);

    results.set(rosterId, {
      valueScore,
      rawValue: valueReceived,
    });
  }

  return results;
}

// ============================================================
// Production scoring — roster-scoped, layered (v2)
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

/** Pre-loaded context for production scoring across many trades. */
export interface ProductionContext {
  seasonalData: SeasonalData;
  weeklyScores: Map<string, Map<string, PlayerWeekData[]>>;
  matchupOutcomes: Map<string, MatchupResult>;
  playoffConfig: Map<string, PlayoffConfig>;
  leagueSeasonMap: Map<string, string>;
  leagueOwnerRoster: Map<string, Map<string, number>>; // leagueId -> ownerId -> rosterId
  leagueRosterOwner: Map<string, Map<number, string>>; // leagueId -> rosterId -> ownerId (reverse)
  familyLeagueIds: string[];
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
    week: number;
  },
  ctx: ProductionContext,
  pickResolver?: PickResolver,
  tradeSeason?: number,
): Map<number, ProductionResult> {
  const results = new Map<number, ProductionResult>();
  const resolvedSeason =
    tradeSeason ?? fallbackTradeSeason(trade.createdAt);

  // Resolve draft pick players for production scoring
  const pickReceivedPlayers = new Map<number, string[]>();
  if (pickResolver && trade.draftPicks) {
    for (const dp of trade.draftPicks) {
      const resolution = pickResolver({
        season: dp.season,
        round: dp.round,
        roster_id: dp.roster_id,
      });
      if (resolution.resolved === "player" && resolution.playerId) {
        const received = pickReceivedPlayers.get(dp.owner_id) || [];
        received.push(resolution.playerId);
        pickReceivedPlayers.set(dp.owner_id, received);
      }
    }
  }

  for (const rosterId of trade.rosterIds) {
    const receivedPlayerIds = Object.entries(trade.adds)
      .filter(([, rid]) => rid === rosterId)
      .map(([pid]) => pid);
    receivedPlayerIds.push(
      ...(pickReceivedPlayers.get(rosterId) || []),
    );

    let totalProduction = 0;
    let totalWeeksUsed = 0;

    // Look up the owner for this rosterId in the trade's league (O(1) reverse map)
    const ownerId = ctx.leagueRosterOwner
      .get(trade.leagueId)
      ?.get(rosterId);

    for (const playerId of receivedPlayerIds) {
      const position = ctx.seasonalData.positions.get(playerId);
      if (!position) continue;

      // Compute production across all family leagues from trade season onward
      for (const leagueId of ctx.familyLeagueIds) {
        const leagueSeason = ctx.leagueSeasonMap.get(leagueId);
        if (!leagueSeason) continue;
        const seasonNum = parseInt(leagueSeason, 10);
        if (seasonNum < resolvedSeason) continue;

        // Determine the rosterId for this owner in this league
        let targetRosterId: number | undefined;
        if (leagueId === trade.leagueId) {
          targetRosterId = rosterId;
        } else if (ownerId) {
          const ownerMap = ctx.leagueOwnerRoster.get(leagueId);
          targetRosterId = ownerMap?.get(ownerId);
        }

        // Look up seasonal data for replacement PPG / maxPAR
        const seasonKey = seasonPositionKey(leagueSeason, position);
        const repPPG =
          ctx.seasonalData.replacementPPG.get(seasonKey) ?? 0;
        const maxPAR = ctx.seasonalData.maxPAR.get(seasonKey) ?? 1;

        // Get player's scores in this league
        const leagueScores = ctx.weeklyScores.get(leagueId);
        const playerScores = leagueScores?.get(playerId);
        if (!playerScores) continue;

        // Filter to roster-scoped + post-trade weeks
        const filteredScores = playerScores.filter((ws) => {
          if (
            targetRosterId !== undefined &&
            ws.rosterId !== targetRosterId
          )
            return false;
          if (
            leagueId === trade.leagueId &&
            ws.week < trade.week
          )
            return false;
          return true;
        });

        if (filteredScores.length === 0) continue;

        const leaguePlayoffConfig = ctx.playoffConfig.get(leagueId);
        const { production, weeksUsed } =
          playerLayeredProduction(
            filteredScores,
            repPPG,
            maxPAR,
            {
              matchupOutcomes: ctx.matchupOutcomes,
              playoffStart:
                leaguePlayoffConfig?.playoffStart ?? null,
              championshipWeek:
                leaguePlayoffConfig?.championshipWeek ?? null,
              playoffRosterIds:
                leaguePlayoffConfig?.winnersBracketRosterIds ?? null,
              leagueId,
            },
          );

        totalProduction += production;
        totalWeeksUsed += weeksUsed;
      }
    }

    // Roster-scoped: no productionSent — sent players' post-trade production
    // doesn't count against you. Delta is just received production.
    const productionScore = normalizeScore(
      totalProduction,
      GRADE_CONFIG.productionScaling,
    );

    results.set(rosterId, {
      productionScore,
      weeksUsed: totalWeeksUsed,
    });
  }

  return results;
}

/** Fallback: derive trade season from timestamp when league season is unavailable */
export function fallbackTradeSeason(createdAt: number): number {
  const d = new Date(createdAt);
  const year = d.getFullYear();
  return d.getMonth() < 3 ? year - 1 : year;
}

// ============================================================
// Blending and grading
// ============================================================

export async function gradeLeagueTrades(
  leagueId: string,
  familyId: string,
  opts?: { syncedAt?: Date },
): Promise<number> {
  const db = getDb();

  const syncedAt =
    opts?.syncedAt ??
    (await syncFantasyCalcValues(leagueId, { force: true }));
  if (!syncedAt) {
    console.warn("[tradeGrading] Failed to sync FantasyCalc values");
    return 0;
  }

  const { ppr, isSuperFlex } =
    await loadLeagueScoringConfig(leagueId);
  const { familyLeagueIds, leagueSeasonMap } =
    await loadFamilyLeagueMap(familyId);
  if (familyLeagueIds.length === 0) return 0;

  const snapshot = await loadFantasyCalcSnapshot(isSuperFlex, ppr);

  const { draftsBySeason, draftPicksMap } =
    await resolveDraftPicks(familyLeagueIds);

  const roundAverages = new Map<number, number>();
  const pickValRows = await db
    .select({
      playerName: schema.fantasyCalcValues.playerName,
      value: schema.fantasyCalcValues.value,
    })
    .from(schema.fantasyCalcValues)
    .where(
      and(
        eq(schema.fantasyCalcValues.isSuperFlex, isSuperFlex),
        eq(schema.fantasyCalcValues.ppr, ppr),
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
    for (const [round, value] of Object.entries(
      DEFAULT_ROUND_AVERAGES,
    )) {
      roundAverages.set(Number(round), value);
    }
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

  const seasonalData = await computeSeasonalRanks(
    familyLeagueIds,
    leagueSeasonMap,
    { isSuperFlex },
  );

  // Load v2 data concurrently — these have no dependencies on each other
  const [weeklyScores, matchupOutcomes, playoffConfig, leagueOwnerRoster] =
    await Promise.all([
      loadPlayerWeeklyScores(familyLeagueIds),
      loadMatchupOutcomes(familyLeagueIds),
      loadPlayoffConfig(familyLeagueIds),
      loadLeagueOwnerRosters(familyLeagueIds),
    ]);

  // Build reverse map: leagueId -> rosterId -> ownerId (O(1) lookups)
  const leagueRosterOwner = new Map<string, Map<number, string>>();
  for (const [leagueId, ownerMap] of leagueOwnerRoster) {
    const reverseMap = new Map<number, string>();
    for (const [ownerId, rosterId] of ownerMap) {
      reverseMap.set(rosterId, ownerId);
    }
    leagueRosterOwner.set(leagueId, reverseMap);
  }

  const productionCtx: ProductionContext = {
    seasonalData,
    weeklyScores,
    matchupOutcomes,
    playoffConfig,
    leagueSeasonMap,
    leagueOwnerRoster,
    leagueRosterOwner,
    familyLeagueIds,
  };

  const trades = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.leagueId, leagueId),
        eq(schema.transactions.type, "trade"),
      ),
    );

  // Collect all grade rows, then batch-upsert (avoids N+1 per-trade-side writes)
  const allGradeRows: Array<typeof schema.tradeGrades.$inferInsert> = [];

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
    const pw = productionWeight(weeksElapsed, "trade");

    const leagueSeason = leagueSeasonMap.get(trade.leagueId);
    const tradeSeason = leagueSeason
      ? parseInt(leagueSeason, 10)
      : fallbackTradeSeason(tradeTimestamp);

    const valueScores = computeValueScores(
      { adds, drops, draftPicks, rosterIds },
      snapshot,
      pickResolver,
    );

    let productionScores: Map<number, ProductionResult> | null =
      null;
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
            week: trade.week,
          },
          productionCtx,
          pickResolver,
          tradeSeason,
        );
      } catch (e) {
        console.warn(
          `[tradeGrading] Production scoring failed for tx ${trade.id}:`,
          e,
        );
      }
    }

    const now = new Date();
    for (const rosterId of rosterIds) {
      const vs = valueScores.get(rosterId);
      const ps = productionScores?.get(rosterId);

      const valueScore = vs?.valueScore ?? 50;
      const rawValue = vs?.rawValue ?? 0;
      const prodScore = ps?.productionScore ?? 50;
      const weeksUsed = ps?.weeksUsed ?? 0;

      const blendedScore =
        (1 - pw) * valueScore + pw * prodScore;
      const grade = scoreToGrade(blendedScore);

      allGradeRows.push({
        transactionId: trade.id,
        rosterId,
        valueScore,
        fantasyCalcValue: rawValue,
        productionScore: weeksUsed > 0 ? prodScore : null,
        productionWeeks: weeksUsed > 0 ? weeksUsed : null,
        blendedScore,
        productionWeight: pw,
        grade,
        computedAt: now,
      });
    }
  }

  // Batch upsert all grade rows
  const BATCH_SIZE = 100;
  for (let i = 0; i < allGradeRows.length; i += BATCH_SIZE) {
    const batch = allGradeRows.slice(i, i + BATCH_SIZE);
    await db
      .insert(schema.tradeGrades)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          schema.tradeGrades.transactionId,
          schema.tradeGrades.rosterId,
        ],
        set: {
          valueScore: sql`excluded.value_score`,
          fantasyCalcValue: sql`excluded.fantasy_calc_value`,
          productionScore: sql`excluded.production_score`,
          productionWeeks: sql`excluded.production_weeks`,
          blendedScore: sql`excluded.blended_score`,
          productionWeight: sql`excluded.production_weight`,
          grade: sql`excluded.grade`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }

  const graded = allGradeRows.length;
  console.log(
    `[tradeGrading] Graded ${graded} trade sides for league ${leagueId}`,
  );
  return graded;
}
