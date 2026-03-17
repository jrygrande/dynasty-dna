import { getDb, schema } from "@/db";
import { eq, and, inArray, sql, gte } from "drizzle-orm";

// ============================================================
// Grade Configuration — calibrated via scripts/calibrate-trade-grades.ts
// ============================================================

export const GRADE_CONFIG = {
  blendCap: 0.9,
  blendHalflife: 0.8,
  startRateBonusMagnitude: 0.1,
  valueScalingFactor: 15000,
  productionScalingFactor: 3,
  thresholds: {
    "A+": 78,
    A: 69,
    "B+": 62,
    B: 54,
    C: 46,
    D: 38,
    "D-": 30,
  } as Record<string, number>,
};

// ============================================================
// Draft pick resolution
// ============================================================

export interface PickResolution {
  value: number;
  resolved: "player" | "round-avg" | "missing";
  playerId?: string;
}

/**
 * Resolve a traded draft pick to either:
 * 1. The actual player drafted (if draft is complete + slotToRosterId available)
 * 2. A round-average FantasyCalc value (if draft not complete)
 * 3. Missing (value 0)
 */
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
  draftPicks: Map<string, Map<number, string>>, // draftId → pickNo → playerId
  playerSnapshot: Map<string, number>,
  roundAverages: Map<number, number>
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

    // Find which slot belongs to this roster_id
    let originalSlot: number | null = null;
    for (const [slot, rosterId] of Object.entries(slotMap)) {
      if (rosterId === pick.roster_id) {
        originalSlot = parseInt(slot, 10);
        break;
      }
    }

    if (originalSlot !== null) {
      // Calculate pick_no for this slot in the given round
      let pickNo: number;
      if (isSnake && pick.round % 2 === 0) {
        // Even rounds reverse in snake drafts
        pickNo = (pick.round - 1) * teams + (teams + 1 - originalSlot);
      } else {
        pickNo = (pick.round - 1) * teams + originalSlot;
      }

      // Look up the player drafted at that pick
      const picksForDraft = draftPicks.get(draftInfo.draftId);
      const playerId = picksForDraft?.get(pickNo);

      if (playerId) {
        const value = playerSnapshot.get(playerId);
        if (value !== undefined) {
          return { value, resolved: "player", playerId };
        }
        // Player drafted but no FantasyCalc value — fall through to round avg
      }
    }
  }

  // Future pick or failed resolution: use round average
  const avgValue = roundAverages.get(pick.round);
  if (avgValue !== undefined) {
    return { value: avgValue, resolved: "round-avg" };
  }

  return { value: 0, resolved: "missing" };
}

// ============================================================
// 3a: Blend function
// ============================================================

/**
 * Hyperbolic blend: cap * years / (years + halflife)
 * 0yr→0%, ~1yr→50%, 2yr→64%, ∞→90%
 */
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
// 3b: Value scoring (FantasyCalc)
// ============================================================

interface ValueResult {
  valueScore: number;
  rawValue: number;
}

/**
 * Compute value scores for each side of a trade.
 * snapshot: Map<sleeperId, fantasyCalcValue>
 * pickResolver: optional function to resolve draft pick values
 */
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
  }) => PickResolution
): Map<number, ValueResult> {
  const results = new Map<number, ValueResult>();

  for (const rosterId of trade.rosterIds) {
    // Players received (adds where value = this rosterId)
    let valueReceived = 0;
    for (const [playerId, addedToRoster] of Object.entries(trade.adds)) {
      if (addedToRoster === rosterId) {
        valueReceived += snapshot.get(playerId) || 0;
      }
    }

    // Draft picks received (owner_id = rosterId after trade)
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

    // Players sent (drops where value = this rosterId)
    let valueSent = 0;
    for (const [playerId, droppedFromRoster] of Object.entries(trade.drops)) {
      if (droppedFromRoster === rosterId) {
        valueSent += snapshot.get(playerId) || 0;
      }
    }

    // Draft picks sent (previous_owner_id = rosterId)
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
      50 + clamp(diff / GRADE_CONFIG.valueScalingFactor, -1, 1) * 50;

    results.set(rosterId, {
      valueScore: clamp(valueScore, 0, 100),
      rawValue: valueReceived,
    });
  }

  return results;
}

// ============================================================
// 3c: Production scoring
// ============================================================

interface ProductionResult {
  productionScore: number;
  weeksUsed: number;
}

/**
 * Compute production scores for each side of a trade.
 * Uses PPG when NFL-active, availability rate, and fantasy start rate.
 */
export async function computeProductionScores(
  trade: {
    adds: Record<string, number>;
    draftPicks?: Array<{
      season: string;
      round: number;
      roster_id: number;
      owner_id: number;
      previous_owner_id: number;
    }>;
    rosterIds: number[];
    createdAt: number; // ms timestamp
    leagueId: string;
  },
  familyLeagueIds: string[],
  leagueSeasonMap: Map<string, string>,
  pickResolver?: (pick: {
    season: string;
    round: number;
    roster_id: number;
  }) => PickResolution
): Promise<Map<number, ProductionResult>> {
  const db = getDb();
  const results = new Map<number, ProductionResult>();
  const tradeDate = new Date(trade.createdAt);

  // Determine trade season/week for filtering post-trade data
  const tradeYear = tradeDate.getFullYear();
  // NFL seasons span Aug-Feb; if month < 3, it's the prior year's season
  const tradeSeason = tradeDate.getMonth() < 3 ? tradeYear - 1 : tradeYear;

  // Get all player IDs involved in adds, and their positions + gsisIds
  const allAddedPlayerIds = [...Object.keys(trade.adds)];

  // Resolve draft pick players for production scoring
  const pickResolvedPlayers = new Map<number, string[]>(); // rosterId → playerIds from picks
  if (pickResolver && trade.draftPicks) {
    for (const dp of trade.draftPicks) {
      const resolution = pickResolver({
        season: dp.season,
        round: dp.round,
        roster_id: dp.roster_id,
      });
      if (resolution.resolved === "player" && resolution.playerId) {
        // This pick was received by dp.owner_id
        const existing = pickResolvedPlayers.get(dp.owner_id) || [];
        existing.push(resolution.playerId);
        pickResolvedPlayers.set(dp.owner_id, existing);
        // Also add to allAddedPlayerIds for player info lookup
        allAddedPlayerIds.push(resolution.playerId);
      }
    }
  }

  if (allAddedPlayerIds.length === 0) {
    for (const rosterId of trade.rosterIds) {
      results.set(rosterId, { productionScore: 50, weeksUsed: 0 });
    }
    return results;
  }

  const playerInfoRows = await db
    .select({
      id: schema.players.id,
      gsisId: schema.players.gsisId,
      position: schema.players.position,
    })
    .from(schema.players)
    .where(inArray(schema.players.id, allAddedPlayerIds));

  const playerInfo = new Map(playerInfoRows.map((p) => [p.id, p]));

  // Build positional averages from family leagues
  const positionalAvgs = new Map<string, number>();
  const positions = [
    ...new Set(playerInfoRows.map((p) => p.position).filter(Boolean)),
  ] as string[];

  if (positions.length > 0 && familyLeagueIds.length > 0) {
    const posAvgRows2 = await db
      .select({
        position: schema.players.position,
        points: schema.playerScores.points,
        isStarter: schema.playerScores.isStarter,
      })
      .from(schema.playerScores)
      .innerJoin(
        schema.players,
        eq(schema.playerScores.playerId, schema.players.id)
      )
      .where(
        and(
          inArray(schema.playerScores.leagueId, familyLeagueIds),
          inArray(schema.players.position, positions)
        )
      );

    const posGroups = new Map<
      string,
      { weightedSum: number; weightSum: number }
    >();
    for (const row of posAvgRows2) {
      const pos = row.position!;
      const weight = row.isStarter ? 1.0 : 0.3;
      const existing = posGroups.get(pos) || { weightedSum: 0, weightSum: 0 };
      existing.weightedSum += (row.points || 0) * weight;
      existing.weightSum += weight;
      posGroups.set(pos, existing);
    }

    for (const [pos, stats] of posGroups) {
      positionalAvgs.set(
        pos,
        stats.weightSum > 0 ? stats.weightedSum / stats.weightSum : 0
      );
    }
  }

  // Now compute per-side production scores
  const nowMs = Date.now();

  for (const rosterId of trade.rosterIds) {
    const receivedPlayerIds = Object.entries(trade.adds)
      .filter(([, rid]) => rid === rosterId)
      .map(([pid]) => pid);

    // Add players drafted with received picks
    const pickPlayers = pickResolvedPlayers.get(rosterId) || [];
    receivedPlayerIds.push(...pickPlayers);

    if (receivedPlayerIds.length === 0) {
      results.set(rosterId, { productionScore: 50, weeksUsed: 0 });
      continue;
    }

    let sideContribution = 0;
    let totalWeeksUsed = 0;

    for (const playerId of receivedPlayerIds) {
      const info = playerInfo.get(playerId);
      if (!info?.gsisId || !info.position) continue;

      // Signal 1: Get NFL-active weeks for this player post-trade
      const activeWeeksRows = await db
        .select({
          season: schema.nflWeeklyRosterStatus.season,
          week: schema.nflWeeklyRosterStatus.week,
        })
        .from(schema.nflWeeklyRosterStatus)
        .where(
          and(
            eq(schema.nflWeeklyRosterStatus.gsisId, info.gsisId),
            eq(schema.nflWeeklyRosterStatus.status, "ACT"),
            gte(schema.nflWeeklyRosterStatus.season, tradeSeason)
          )
        );

      // Filter to post-trade weeks only
      const activeWeeks = activeWeeksRows.filter((w) => {
        if (w.season > tradeSeason) return true;
        if (w.season === tradeSeason) {
          const sept1 = new Date(tradeSeason, 8, 1);
          const tradeWeekApprox = Math.max(
            1,
            Math.ceil(
              (tradeDate.getTime() - sept1.getTime()) /
                (7 * 24 * 60 * 60 * 1000)
            )
          );
          return w.week > tradeWeekApprox;
        }
        return false;
      });

      if (activeWeeks.length === 0) continue;

      // Get fantasy scores for active weeks across all family leagues
      let ppgWhenActive = 0;
      let startCount = 0;
      let totalAppearances = 0;

      // Query scores for this player in family leagues
      const scoreRows = await db
        .select({
          points: schema.playerScores.points,
          isStarter: schema.playerScores.isStarter,
          week: schema.playerScores.week,
          leagueId: schema.playerScores.leagueId,
        })
        .from(schema.playerScores)
        .where(
          and(
            inArray(schema.playerScores.leagueId, familyLeagueIds),
            eq(schema.playerScores.playerId, playerId)
          )
        );

      // Filter to active weeks — match by season+week using leagueSeasonMap
      const activeWeekSet = new Set(
        activeWeeks.map((w) => `${w.season}-${w.week}`)
      );

      const relevantScores = scoreRows.filter((s) => {
        const season = leagueSeasonMap.get(s.leagueId);
        return season && activeWeekSet.has(`${season}-${s.week}`);
      });

      if (relevantScores.length > 0) {
        const totalPts = relevantScores.reduce(
          (sum, s) => sum + (s.points || 0),
          0
        );
        ppgWhenActive = totalPts / activeWeeks.length;
        startCount = relevantScores.filter((s) => s.isStarter).length;
        totalAppearances = relevantScores.length;
      }

      // Signal 2: Availability rate
      const seasonsSinceTrade = Math.max(
        1,
        Math.ceil(
          (nowMs - trade.createdAt) / (365.25 * 24 * 60 * 60 * 1000)
        )
      );
      const maxNflWeeks = seasonsSinceTrade * 18;
      const availabilityRate = Math.min(1, activeWeeks.length / maxNflWeeks);

      // Signal 3: Start rate bonus
      const startRate =
        totalAppearances > 0 ? startCount / totalAppearances : 0.5;
      const startBonus =
        1 +
        GRADE_CONFIG.startRateBonusMagnitude *
          clamp(startRate - 0.5, -0.5, 0.5);

      // Positional average
      const posAvg = positionalAvgs.get(info.position) || 0;

      // Player contribution
      const playerContribution =
        (ppgWhenActive - posAvg) *
        activeWeeks.length *
        clamp(availabilityRate, 0, 1) *
        startBonus;

      sideContribution += playerContribution;
      totalWeeksUsed += activeWeeks.length;
    }

    const productionScore =
      50 +
      clamp(
        sideContribution / GRADE_CONFIG.productionScalingFactor,
        -50,
        50
      );

    results.set(rosterId, {
      productionScore: clamp(productionScore, 0, 100),
      weeksUsed: totalWeeksUsed,
    });
  }

  return results;
}

// ============================================================
// 3d: Blending and grading
// ============================================================

/**
 * Grade all trades for a league. Returns count of trades graded.
 */
export async function gradeLeagueTrades(
  leagueId: string,
  familyId: string
): Promise<number> {
  const db = getDb();

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

  // Build leagueId → season map for production scoring
  const leagueSeasonMap = new Map<string, string>(
    familyMembers.map((m) => [m.leagueId, m.season])
  );

  // Get latest FantasyCalc snapshot
  const [latestFetch] = await db
    .select({
      latest: sql<string>`max(${schema.fantasyCalcValues.fetchedAt})`,
    })
    .from(schema.fantasyCalcValues);

  if (!latestFetch?.latest) {
    console.warn("[tradeGrading] No FantasyCalc values available");
    return 0;
  }

  const snapshotRows = await db
    .select({
      playerId: schema.fantasyCalcValues.playerId,
      value: schema.fantasyCalcValues.value,
    })
    .from(schema.fantasyCalcValues)
    .where(
      eq(
        schema.fantasyCalcValues.fetchedAt,
        new Date(latestFetch.latest)
      )
    );

  const snapshot = new Map<string, number>();
  for (const row of snapshotRows) {
    snapshot.set(row.playerId, row.value);
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

  // Get totalRosters per league for pick_no calculation
  const leagueRosterCounts = await db
    .select({
      id: schema.leagues.id,
      totalRosters: schema.leagues.totalRosters,
    })
    .from(schema.leagues)
    .where(inArray(schema.leagues.id, familyLeagueIds));

  const rosterCountMap = new Map(
    leagueRosterCounts.map((l) => [l.id, l.totalRosters || 12])
  );

  // Build season → draft info map
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

  // Load draft picks for completed drafts
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
  // FantasyCalc returns picks with position "PICK" — we can compute from the snapshot
  // For now, use the snapshot values for entries that look like picks
  // or fall back to reasonable defaults
  const roundAverages = new Map<number, number>();
  // Collect values per round from snapshot (pick entries stored with "PICK" position)
  const pickValRows = await db
    .select({
      playerName: schema.fantasyCalcValues.playerName,
      value: schema.fantasyCalcValues.value,
    })
    .from(schema.fantasyCalcValues)
    .where(
      and(
        eq(
          schema.fantasyCalcValues.fetchedAt,
          new Date(latestFetch.latest)
        ),
        eq(schema.fantasyCalcValues.position, "PICK")
      )
    );

  if (pickValRows.length > 0) {
    const roundGroups = new Map<number, number[]>();
    for (const row of pickValRows) {
      // Parse round from name like "2026 Mid 1st" or "2026 Pick 1.01"
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
        values.reduce((a, b) => a + b, 0) / values.length
      );
    }
  }

  // If no pick data from DB, use fallback averages
  if (roundAverages.size === 0) {
    roundAverages.set(1, 6000);
    roundAverages.set(2, 2500);
    roundAverages.set(3, 1000);
    roundAverages.set(4, 250);
  }

  // Build pick resolver
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
      roundAverages
    );

  // Get all trade transactions for this league
  const trades = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.leagueId, leagueId),
        eq(schema.transactions.type, "trade")
      )
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
      (Date.now() - tradeTimestamp) / (7 * 24 * 60 * 60 * 1000)
    );
    const pw = productionWeight(weeksElapsed);

    // Value scores
    const valueScores = computeValueScores(
      { adds, drops, draftPicks, rosterIds },
      snapshot,
      pickResolver
    );

    // Production scores (skip for very recent trades)
    let productionScores: Map<number, ProductionResult> | null = null;
    if (weeksElapsed > 0) {
      try {
        productionScores = await computeProductionScores(
          {
            adds,
            draftPicks,
            rosterIds,
            createdAt: tradeTimestamp,
            leagueId: trade.leagueId,
          },
          familyLeagueIds,
          leagueSeasonMap,
          pickResolver
        );
      } catch (e) {
        console.warn(
          `[tradeGrading] Production scoring failed for tx ${trade.id}:`,
          e
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

      const blendedScore =
        (1 - pw) * valueScore + pw * prodScore;
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
    `[tradeGrading] Graded ${graded} trade sides for league ${leagueId}`
  );
  return graded;
}
