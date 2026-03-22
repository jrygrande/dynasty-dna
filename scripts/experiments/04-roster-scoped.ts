/**
 * Experiment 4: Roster-Scoped vs Unbounded Production
 *
 * Hypothesis: Scoping production to roster ownership windows produces more
 * intuitive trade grades than the current unbounded approach.
 *
 * Method:
 *   Find trades where a sent-away player had a post-trade breakout.
 *   Compare grades under:
 *     (a) unbounded production (v1 — counts post-trade production of sent players)
 *     (b) roster-scoped production (v2 — production stops at trade date)
 *   Manual review of the 20 most extreme cases.
 *
 * Usage: npx tsx scripts/experiments/04-roster-scoped.ts
 */

import { db, schema } from "./helpers";
import { eq, and, inArray } from "drizzle-orm";
import {
  playerProductionScore,
  playerSeasonalPAR,
  computeSeasonalRanks,
  loadPlayerWeeklyScores,
  normalizeScore,
  GRADE_CONFIG,
} from "../../src/services/gradingCore";
import { printTable } from "./helpers";

async function run() {
  console.log("=== Experiment: Roster-Scoped vs Unbounded Production ===\n");

  const families = await db.select().from(schema.leagueFamilies);
  if (families.length === 0) {
    console.log("No league families found.");
    return;
  }

  for (const family of families) {
    console.log(`\n--- Family: ${family.name} ---`);

    const members = await db
      .select()
      .from(schema.leagueFamilyMembers)
      .where(eq(schema.leagueFamilyMembers.familyId, family.id));

    const familyLeagueIds = members.map((m) => m.leagueId);
    const leagueSeasonMap = new Map(
      members.map((m) => [m.leagueId, m.season] as [string, string]),
    );

    const seasonalData = await computeSeasonalRanks(
      familyLeagueIds,
      leagueSeasonMap,
      { isSuperFlex: false },
    );

    const weeklyScores = await loadPlayerWeeklyScores(familyLeagueIds);

    // Load trades
    const trades = await db
      .select()
      .from(schema.transactions)
      .where(
        and(
          inArray(schema.transactions.leagueId, familyLeagueIds),
          eq(schema.transactions.type, "trade"),
        ),
      );

    // Load player names for display
    const allPlayerIds = new Set<string>();
    for (const trade of trades) {
      const adds = (trade.adds || {}) as Record<string, number>;
      const drops = (trade.drops || {}) as Record<string, number>;
      for (const pid of Object.keys(adds)) allPlayerIds.add(pid);
      for (const pid of Object.keys(drops)) allPlayerIds.add(pid);
    }

    const playerNames = new Map<string, string>();
    if (allPlayerIds.size > 0) {
      const playerBatches: string[][] = [];
      const pidArr = [...allPlayerIds];
      for (let i = 0; i < pidArr.length; i += 500) {
        playerBatches.push(pidArr.slice(i, i + 500));
      }
      for (const batch of playerBatches) {
        const rows = await db
          .select({ id: schema.players.id, name: schema.players.name })
          .from(schema.players)
          .where(inArray(schema.players.id, batch));
        for (const r of rows) playerNames.set(r.id, r.name);
      }
    }

    const currentYear = new Date().getFullYear();

    interface TradeCase {
      tradeId: string;
      leagueId: string;
      season: string;
      week: number;
      rosterId: number;
      sentPlayerNames: string[];
      receivedPlayerNames: string[];
      unboundedDelta: number;
      scopedDelta: number;
      scoreDiff: number;
    }

    const cases: TradeCase[] = [];

    for (const trade of trades) {
      const adds = (trade.adds || {}) as Record<string, number>;
      const drops = (trade.drops || {}) as Record<string, number>;
      const rosterIds = (trade.rosterIds || []) as number[];
      const leagueSeason = leagueSeasonMap.get(trade.leagueId);
      if (!leagueSeason) continue;
      const tradeSeason = parseInt(leagueSeason, 10);

      for (const rosterId of rosterIds) {
        const receivedIds = Object.entries(adds)
          .filter(([, rid]) => rid === rosterId)
          .map(([pid]) => pid);
        const sentIds = Object.entries(drops)
          .filter(([, rid]) => rid === rosterId)
          .map(([pid]) => pid);

        if (sentIds.length === 0) continue;

        // v1 unbounded: total production from trade season onward
        let unboundedReceived = 0;
        let unboundedSent = 0;
        for (const pid of receivedIds) {
          unboundedReceived += playerSeasonalPAR(pid, tradeSeason, currentYear, seasonalData);
        }
        for (const pid of sentIds) {
          unboundedSent += playerSeasonalPAR(pid, tradeSeason, currentYear, seasonalData);
        }
        const unboundedDelta = unboundedReceived - unboundedSent;

        // v2 roster-scoped: only count production on the receiving roster
        let scopedReceived = 0;
        for (const pid of receivedIds) {
          const leagueScores = weeklyScores.get(trade.leagueId);
          const playerScores = leagueScores?.get(pid);
          if (!playerScores) continue;

          // Sum points only for weeks on this roster, post-trade
          const rosterScores = playerScores.filter(
            (ws) => ws.rosterId === rosterId && ws.week >= trade.week,
          );
          const position = seasonalData.positions.get(pid);
          if (!position) continue;
          const seasonKey = `${leagueSeason}:${position}`;
          const repPPG = seasonalData.replacementPPG.get(seasonKey) ?? 0;
          const maxPAR = seasonalData.maxPAR.get(seasonKey) ?? 1;

          for (const ws of rosterScores) {
            const par = Math.max(0, ws.points - repPPG);
            scopedReceived += maxPAR > 0 ? Math.min(100, (par / maxPAR) * 100) / 18 : 0;
          }
        }
        // Sent = 0 in scoped model
        const scopedDelta = scopedReceived;

        const unboundedScore = normalizeScore(unboundedDelta, GRADE_CONFIG.productionScaling);
        const scopedScore = normalizeScore(scopedDelta, GRADE_CONFIG.productionScaling);
        const scoreDiff = Math.abs(unboundedScore - scopedScore);

        cases.push({
          tradeId: trade.id,
          leagueId: trade.leagueId,
          season: leagueSeason,
          week: trade.week,
          rosterId,
          sentPlayerNames: sentIds.map((id) => playerNames.get(id) || id).slice(0, 3),
          receivedPlayerNames: receivedIds.map((id) => playerNames.get(id) || id).slice(0, 3),
          unboundedDelta: Math.round(unboundedDelta * 10) / 10,
          scopedDelta: Math.round(scopedDelta * 10) / 10,
          scoreDiff: Math.round(scoreDiff * 10) / 10,
        });
      }
    }

    // Sort by score difference (most extreme first)
    cases.sort((a, b) => b.scoreDiff - a.scoreDiff);
    const top = cases.slice(0, 20);

    if (top.length === 0) {
      console.log("  No trade cases found.");
      continue;
    }

    console.log(`\n  Top ${top.length} trades with largest score difference:\n`);

    printTable(
      ["Season", "Wk", "Sent", "Received", "Unbound", "Scoped", "Diff"],
      top.map((c) => [
        c.season,
        c.week,
        c.sentPlayerNames.join(", ").slice(0, 25),
        c.receivedPlayerNames.join(", ").slice(0, 25),
        c.unboundedDelta,
        c.scopedDelta,
        c.scoreDiff,
      ]),
    );

    // Summary stats
    const allDiffs = cases.map((c) => c.scoreDiff);
    const avgDiff =
      allDiffs.length > 0
        ? Math.round((allDiffs.reduce((a, b) => a + b, 0) / allDiffs.length) * 10) / 10
        : 0;
    const bigSwings = cases.filter((c) => c.scoreDiff > 10).length;

    console.log(`\n  Summary: ${cases.length} trade sides analyzed`);
    console.log(`  Average score difference: ${avgDiff}`);
    console.log(
      `  Trades with >10pt difference: ${bigSwings} (${Math.round((bigSwings / Math.max(cases.length, 1)) * 100)}%)`,
    );
  }

  console.log("\nLarger diffs = more cases where roster scoping changes the grade.");
  console.log("Done.");
}

run().catch(console.error);
