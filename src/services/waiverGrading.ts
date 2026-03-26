import { getDb, schema } from "@/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { syncFantasyCalcValues } from "@/services/fantasyCalcSync";
import {
  GRADE_CONFIG,
  QUALITY_WEIGHTS,
  productionWeight,
  scoreToGrade,
  normalizeScore,
  clamp,
  computeQualityQuantityScores,
  computePercentile,
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
} from "@/services/gradingCore";
import { batchUpsertManagerMetrics, BATCH_SIZE } from "@/services/batchHelper";
import { type ProductionContext } from "@/services/tradeGrading";

// ============================================================
// Waiver Grading Configuration
// ============================================================

/** Waiver players have smaller value diffs than trades — use a lower scaling factor */
const WAIVER_VALUE_SCALING = 3000;

/** Max FAAB bonus points added to the blended score */
const FAAB_BONUS_MAX = 10;

// ============================================================
// Types
// ============================================================

interface PendingGrade {
  transactionId: string;
  rosterId: number;
  playerId: string | null;
  droppedPlayerId: string | null;
  valueScore: number;
  acquiredValue: number;
  droppedValue: number;
  faabBid: number | null;
  faabEfficiency: number | null;
  productionScore: number;
  productionWeeks: number;
  rawPAR: number;
  blendedScore: number;
  productionWeight: number;
}

// ============================================================
// Per-pickup production scoring
// ============================================================

function computePickupProduction(
  playerId: string,
  rosterId: number,
  txWeek: number,
  txLeagueId: string,
  txSeason: number,
  ctx: ProductionContext,
): { productionScore: number; weeksUsed: number; rawPAR: number } {
  const position = ctx.seasonalData.positions.get(playerId);
  if (!position) return { productionScore: 50, weeksUsed: 0, rawPAR: 0 };

  const ownerId = ctx.leagueRosterOwner.get(txLeagueId)?.get(rosterId);

  let totalProduction = 0;
  let totalWeeksUsed = 0;
  let totalRawPAR = 0;

  for (const leagueId of ctx.familyLeagueIds) {
    const leagueSeason = ctx.leagueSeasonMap.get(leagueId);
    if (!leagueSeason) continue;
    const seasonNum = parseInt(leagueSeason, 10);
    if (seasonNum < txSeason) continue;

    // Determine the rosterId for this owner in this league
    let targetRosterId: number | undefined;
    if (leagueId === txLeagueId) {
      targetRosterId = rosterId;
    } else if (ownerId) {
      targetRosterId = ctx.leagueOwnerRoster.get(leagueId)?.get(ownerId);
    }

    const seasonKey = seasonPositionKey(leagueSeason, position);
    const repPPG = ctx.seasonalData.replacementPPG.get(seasonKey) ?? 0;
    const maxPAR = ctx.seasonalData.maxPAR.get(seasonKey) ?? 1;

    const playerScores = ctx.weeklyScores.get(leagueId)?.get(playerId);
    if (!playerScores) continue;

    // Filter to roster-scoped + post-acquisition weeks
    const filteredScores = playerScores.filter((ws) => {
      if (targetRosterId !== undefined && ws.rosterId !== targetRosterId)
        return false;
      if (leagueId === txLeagueId && ws.week < txWeek) return false;
      return true;
    });

    if (filteredScores.length === 0) continue;

    const leaguePlayoffConfig = ctx.playoffConfig.get(leagueId);
    const { production, weeksUsed, rawTotalPAR } = playerLayeredProduction(
      filteredScores,
      repPPG,
      maxPAR,
      {
        matchupOutcomes: ctx.matchupOutcomes,
        playoffStart: leaguePlayoffConfig?.playoffStart ?? null,
        championshipWeek: leaguePlayoffConfig?.championshipWeek ?? null,
        playoffRosterIds:
          leaguePlayoffConfig?.winnersBracketRosterIds ?? null,
        leagueId,
      },
    );

    totalProduction += production;
    totalWeeksUsed += weeksUsed;
    totalRawPAR += rawTotalPAR;
  }

  const productionScore = normalizeScore(
    totalProduction,
    GRADE_CONFIG.productionScaling,
  );

  return {
    productionScore,
    weeksUsed: totalWeeksUsed,
    rawPAR: totalRawPAR,
  };
}

// ============================================================
// Main grading function
// ============================================================

export async function gradeLeagueWaivers(
  leagueId: string,
  familyId: string,
  opts?: { syncedAt?: Date },
): Promise<number> {
  const db = getDb();

  const syncedAt =
    opts?.syncedAt ??
    (await syncFantasyCalcValues(leagueId, { force: true }));
  if (!syncedAt) {
    console.warn("[waiverGrading] Failed to sync FantasyCalc values");
    return 0;
  }

  const { ppr, isSuperFlex } = await loadLeagueScoringConfig(leagueId);
  const { familyLeagueIds, leagueSeasonMap } =
    await loadFamilyLeagueMap(familyId);
  if (familyLeagueIds.length === 0) return 0;

  const snapshot = await loadFantasyCalcSnapshot(isSuperFlex, ppr);

  // Load production context concurrently
  const [seasonalData, weeklyScores, matchupOutcomes, playoffConfig, leagueOwnerRoster] =
    await Promise.all([
      computeSeasonalRanks(familyLeagueIds, leagueSeasonMap, { isSuperFlex }),
      loadPlayerWeeklyScores(familyLeagueIds),
      loadMatchupOutcomes(familyLeagueIds),
      loadPlayoffConfig(familyLeagueIds),
      loadLeagueOwnerRosters(familyLeagueIds),
    ]);

  // Build reverse map: leagueId -> rosterId -> ownerId
  const leagueRosterOwner = new Map<string, Map<number, string>>();
  for (const [lid, ownerMap] of leagueOwnerRoster) {
    const reverseMap = new Map<number, string>();
    for (const [ownerId, rid] of ownerMap) {
      reverseMap.set(rid, ownerId);
    }
    leagueRosterOwner.set(lid, reverseMap);
  }

  const ctx: ProductionContext = {
    seasonalData,
    weeklyScores,
    matchupOutcomes,
    playoffConfig,
    leagueSeasonMap,
    leagueOwnerRoster,
    leagueRosterOwner,
    familyLeagueIds,
  };

  // Load waiver + free agent transactions
  const transactions = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.leagueId, leagueId),
        inArray(schema.transactions.type, ["waiver", "free_agent"]),
      ),
    );

  if (transactions.length === 0) return 0;

  const leagueSeason = leagueSeasonMap.get(leagueId);
  const txSeason = leagueSeason ? parseInt(leagueSeason, 10) : new Date().getFullYear();

  // ============================================================
  // Pass 1: Compute value + production scores, collect FAAB data
  // ============================================================

  const pendingGrades: PendingGrade[] = [];
  const faabEfficiencies: number[] = [];

  for (const tx of transactions) {
    const adds = (tx.adds || {}) as Record<string, number>;
    const drops = (tx.drops || {}) as Record<string, number>;
    const rosterIds = (tx.rosterIds || []) as number[];

    if (rosterIds.length === 0) continue;
    const rosterId = rosterIds[0];

    // Find the acquired player (first add for this roster)
    const playerId =
      Object.entries(adds).find(([, rid]) => rid === rosterId)?.[0] ?? null;
    if (!playerId) continue;

    // Find the dropped player (first drop for this roster)
    const droppedPlayerId =
      Object.entries(drops).find(([, rid]) => rid === rosterId)?.[0] ?? null;

    // Value scoring
    const acquiredValue = snapshot.get(playerId) ?? 0;
    const droppedValue = droppedPlayerId
      ? (snapshot.get(droppedPlayerId) ?? 0)
      : 0;
    const valueScore = normalizeScore(
      acquiredValue - droppedValue,
      WAIVER_VALUE_SCALING,
    );

    // Production scoring
    const txTimestamp = tx.createdAt ?? Date.now();
    const weeksElapsed = Math.floor(
      (Date.now() - Number(txTimestamp)) / (7 * 24 * 60 * 60 * 1000),
    );

    let productionScore = 50;
    let weeksUsed = 0;
    let rawPAR = 0;

    if (weeksElapsed > 0) {
      const prod = computePickupProduction(
        playerId,
        rosterId,
        tx.week,
        leagueId,
        txSeason,
        ctx,
      );
      productionScore = prod.productionScore;
      weeksUsed = prod.weeksUsed;
      rawPAR = prod.rawPAR;
    }

    // Blend value + production
    const pw = productionWeight(weeksElapsed, "waiver");
    const blendedScore = (1 - pw) * valueScore + pw * productionScore;

    // FAAB efficiency
    const settings = tx.settings as Record<string, unknown> | null;
    const faabBid =
      settings && typeof settings.waiver_bid === "number"
        ? settings.waiver_bid
        : null;
    let faabEfficiency: number | null = null;
    if (faabBid !== null) {
      faabEfficiency = acquiredValue / Math.max(faabBid, 1);
      faabEfficiencies.push(faabEfficiency);
    }

    pendingGrades.push({
      transactionId: tx.id,
      rosterId,
      playerId,
      droppedPlayerId,
      valueScore,
      acquiredValue,
      droppedValue,
      faabBid,
      faabEfficiency,
      productionScore,
      productionWeeks: weeksUsed,
      rawPAR,
      blendedScore,
      productionWeight: pw,
    });
  }

  if (pendingGrades.length === 0) return 0;

  // ============================================================
  // Pass 2: Compute FAAB percentiles, build final grade rows
  // ============================================================

  // Build sorted FAAB efficiency list for percentile ranking
  const sortedFaab = [...faabEfficiencies]
    .sort((a, b) => a - b)
    .map((e) => ({ score: e }));

  const allGradeRows: Array<typeof schema.waiverGrades.$inferInsert> = [];
  const now = new Date();

  for (const pg of pendingGrades) {
    // Apply FAAB bonus (0-10 points based on percentile)
    let faabBonus = 0;
    if (pg.faabEfficiency !== null) {
      const pct = computePercentile({ score: pg.faabEfficiency }, sortedFaab);
      faabBonus = (pct / 100) * FAAB_BONUS_MAX;
    }
    const finalScore = clamp(pg.blendedScore + faabBonus, 0, 100);

    allGradeRows.push({
      transactionId: pg.transactionId,
      rosterId: pg.rosterId,
      playerId: pg.playerId,
      droppedPlayerId: pg.droppedPlayerId,
      valueScore: pg.valueScore,
      playerValue: pg.acquiredValue,
      droppedValue: pg.droppedValue,
      faabBid: pg.faabBid,
      faabEfficiency: pg.faabEfficiency,
      productionScore: pg.productionWeeks > 0 ? pg.productionScore : null,
      productionWeeks: pg.productionWeeks > 0 ? pg.productionWeeks : null,
      rawPAR: pg.productionWeeks > 0 ? pg.rawPAR : null,
      blendedScore: finalScore,
      productionWeight: pg.productionWeight,
      grade: scoreToGrade(finalScore),
      computedAt: now,
    });
  }

  // ============================================================
  // Batch upsert grade rows
  // ============================================================

  for (let i = 0; i < allGradeRows.length; i += BATCH_SIZE) {
    const batch = allGradeRows.slice(i, i + BATCH_SIZE);
    await db
      .insert(schema.waiverGrades)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          schema.waiverGrades.transactionId,
          schema.waiverGrades.rosterId,
        ],
        set: {
          playerId: sql`excluded.player_id`,
          droppedPlayerId: sql`excluded.dropped_player_id`,
          valueScore: sql`excluded.value_score`,
          playerValue: sql`excluded.player_value`,
          droppedValue: sql`excluded.dropped_value`,
          faabBid: sql`excluded.faab_bid`,
          faabEfficiency: sql`excluded.faab_efficiency`,
          productionScore: sql`excluded.production_score`,
          productionWeeks: sql`excluded.production_weeks`,
          rawPAR: sql`excluded.raw_par`,
          blendedScore: sql`excluded.blended_score`,
          productionWeight: sql`excluded.production_weight`,
          grade: sql`excluded.grade`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }

  const graded = allGradeRows.length;
  console.log(
    `[waiverGrading] Graded ${graded} waiver pickups for league ${leagueId}`,
  );

  // ============================================================
  // Aggregate waiver_score per manager (quality x quantity)
  // ============================================================

  const season = leagueSeasonMap.get(leagueId);
  if (season && allGradeRows.length > 0) {
    const rosterOwnerMap =
      leagueRosterOwner.get(leagueId) ?? new Map<number, string>();

    const managerAgg = new Map<
      string,
      { totalQuality: number; totalRawPAR: number; count: number }
    >();

    for (const row of allGradeRows) {
      const ownerId = rosterOwnerMap.get(row.rosterId);
      if (!ownerId) continue;
      if (!managerAgg.has(ownerId)) {
        managerAgg.set(ownerId, {
          totalQuality: 0,
          totalRawPAR: 0,
          count: 0,
        });
      }
      const agg = managerAgg.get(ownerId)!;
      agg.totalQuality += row.blendedScore ?? 0;
      agg.totalRawPAR += row.rawPAR ?? 0;
      agg.count++;
    }

    const metricValues = computeQualityQuantityScores(managerAgg, {
      leagueId,
      season,
      metric: "waiver_score",
      qualityWeight: QUALITY_WEIGHTS.waiver_score,
      countLabel: "pickupsGraded",
    });

    await batchUpsertManagerMetrics(metricValues);
    console.log(
      `[waiverGrading] Wrote waiver_score for ${metricValues.length} managers in ${leagueId}`,
    );
  }

  return graded;
}
