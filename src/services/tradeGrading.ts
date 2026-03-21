import { getDb, schema } from "@/db";
import { eq, and, inArray } from "drizzle-orm";
import { syncFantasyCalcValues } from "@/services/fantasyCalcSync";
import { findOriginalSlot, calculatePickNumber, resolveDraftPicks } from "@/lib/draft";
import {
  GRADE_CONFIG,
  productionWeight,
  scoreToGrade,
  normalizeScore,
  playerProductionScore,
  computeSeasonalRanks,
  loadLeagueScoringConfig,
  loadFamilyLeagueMap,
  loadFantasyCalcSnapshot,
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
      const pickNo = calculatePickNumber(pick.round, originalSlot, teams, isSnake);

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
    const valueScore = normalizeScore(diff, GRADE_CONFIG.valueScaling);

    results.set(rosterId, {
      valueScore,
      rawValue: valueReceived,
    });
  }

  return results;
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
  seasonalActiveWeeks: Map<string, Map<string, number>>,
  playerPositions: Map<string, string>,
  pickResolver?: PickResolver,
  tradeSeason?: number,
): Map<number, ProductionResult> {
  const results = new Map<number, ProductionResult>();
  const resolvedSeason =
    tradeSeason ?? fallbackTradeSeason(trade.createdAt);
  const currentYear = new Date().getFullYear();

  // Resolve draft pick players for production scoring
  const pickReceivedPlayers = new Map<number, string[]>();
  const pickSentPlayers = new Map<number, string[]>();
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
        const sent = pickSentPlayers.get(dp.previous_owner_id) || [];
        sent.push(resolution.playerId);
        pickSentPlayers.set(dp.previous_owner_id, sent);
      }
    }
  }

  for (const rosterId of trade.rosterIds) {
    const receivedPlayerIds = Object.entries(trade.adds)
      .filter(([, rid]) => rid === rosterId)
      .map(([pid]) => pid);
    receivedPlayerIds.push(...(pickReceivedPlayers.get(rosterId) || []));

    const sentPlayerIds = Object.entries(trade.drops)
      .filter(([, rid]) => rid === rosterId)
      .map(([pid]) => pid);
    sentPlayerIds.push(...(pickSentPlayers.get(rosterId) || []));

    let productionReceived = 0;
    let weeksUsed = 0;
    for (const playerId of receivedPlayerIds) {
      const score = playerProductionScore(
        playerId,
        resolvedSeason,
        currentYear,
        seasonalRanks,
        seasonalActiveWeeks,
        playerPositions,
      );
      productionReceived += score;
      for (let season = resolvedSeason; season <= currentYear; season++) {
        const awMap = seasonalActiveWeeks.get(String(season));
        weeksUsed += awMap?.get(playerId) ?? 0;
      }
    }

    let productionSent = 0;
    for (const playerId of sentPlayerIds) {
      productionSent += playerProductionScore(
        playerId,
        resolvedSeason,
        currentYear,
        seasonalRanks,
        seasonalActiveWeeks,
        playerPositions,
      );
    }

    const delta = productionReceived - productionSent;
    const productionScore = normalizeScore(delta, GRADE_CONFIG.productionScaling);

    results.set(rosterId, {
      productionScore,
      weeksUsed,
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

  const syncedAt = opts?.syncedAt ?? await syncFantasyCalcValues(leagueId, { force: true });
  if (!syncedAt) {
    console.warn("[tradeGrading] Failed to sync FantasyCalc values");
    return 0;
  }

  const { ppr, isSuperFlex } = await loadLeagueScoringConfig(leagueId);
  const { familyLeagueIds, leagueSeasonMap } = await loadFamilyLeagueMap(familyId);
  if (familyLeagueIds.length === 0) return 0;

  const snapshot = await loadFantasyCalcSnapshot(isSuperFlex, ppr);

  const { draftsBySeason, draftPicksMap } = await resolveDraftPicks(familyLeagueIds);

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
    for (const [round, value] of Object.entries(DEFAULT_ROUND_AVERAGES)) {
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

  const { ranks: seasonalRanks, activeWeeks: seasonalActiveWeeks, positions: playerPositions } =
    await computeSeasonalRanks(familyLeagueIds, leagueSeasonMap);

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

    const leagueSeason = leagueSeasonMap.get(trade.leagueId);
    const tradeSeason = leagueSeason
      ? parseInt(leagueSeason, 10)
      : fallbackTradeSeason(tradeTimestamp);

    const valueScores = computeValueScores(
      { adds, drops, draftPicks, rosterIds },
      snapshot,
      pickResolver,
    );

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
          seasonalActiveWeeks,
          playerPositions,
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
