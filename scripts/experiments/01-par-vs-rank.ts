/**
 * Experiment 3: PAR vs Rank-Based Production
 *
 * Hypothesis: Points-above-replacement produces more meaningful production
 * scores than rank-based exponential decay, especially in the "mushy middle"
 * (ranks 12-30) where rank differences are arbitrary.
 *
 * Method:
 *   For each completed season, compute production scores under:
 *     (a) current rank-based
 *     (b) PAR-based
 *   Compare:
 *     1. Correlation of production score with actual PPG contribution
 *     2. Score variance across players at similar ranks
 *     3. Sensitivity to small-sample outliers (players with <5 games)
 *
 * Usage: npx tsx scripts/experiments/01-par-vs-rank.ts
 */

import { db, schema } from "./helpers";
import { eq } from "drizzle-orm";
import {
  rankToProductionValue,
  playerSeasonalPAR,
  computeSeasonalRanks,
} from "../../src/services/gradingCore";
import {
  describeArray,
  spearmanCorrelation,
  printTable,
} from "./helpers";

async function run() {
  console.log("=== Experiment: PAR vs Rank-Based Production ===\n");

  // Find all league families
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

    // Compute seasonal data with both v1 (ranks) and v2 (PAR) info
    const seasonalData = await computeSeasonalRanks(
      familyLeagueIds,
      leagueSeasonMap,
      { isSuperFlex: false },
    );

    // Build per-player PPG lookup from seasonalData (avoids redundant DB query)
    const playerSeasonPPG = new Map<string, number>(); // "playerId:season" -> PPG
    for (const [seasonPosKey, ppgMap] of seasonalData.playerPPG) {
      const season = seasonPosKey.split(":")[0];
      for (const [playerId, ppg] of ppgMap) {
        playerSeasonPPG.set(`${playerId}:${season}`, ppg);
      }
    }

    const seasons = [...new Set(members.map((m) => m.season))];
    const currentYear = new Date().getFullYear();

    const tableRows: (string | number)[][] = [];

    for (const season of seasons) {
      const seasonNum = parseInt(season, 10);

      // Collect all players who have both rank and PAR data
      const v1Scores: number[] = [];
      const v2Scores: number[] = [];
      const actualPPGs: number[] = [];
      const playerIds: string[] = [];
      const positions: string[] = [];

      for (const [playerId, position] of seasonalData.positions) {
        const rankKey = `${season}:${position}`;
        const rankMap = seasonalData.ranks.get(rankKey);
        const rank = rankMap?.get(playerId);
        if (rank === undefined) continue;

        const awMap = seasonalData.activeWeeks.get(season);
        const activeWeekCount = awMap?.get(playerId) ?? 0;

        // v1: rank-based
        const v1Score = rankToProductionValue(rank, activeWeekCount, position);

        // v2: PAR-based
        const v2Score = playerSeasonalPAR(playerId, seasonNum, seasonNum, seasonalData);

        // Actual PPG
        const ppgKey = `${playerId}:${season}`;
        const ppg = playerSeasonPPG.get(ppgKey);
        if (ppg === undefined) continue;

        v1Scores.push(v1Score);
        v2Scores.push(v2Score);
        actualPPGs.push(ppg);
        playerIds.push(playerId);
        positions.push(position);
      }

      if (v1Scores.length < 10) continue;

      // Metric 1: Correlation with actual PPG
      const corrV1 = spearmanCorrelation(v1Scores, actualPPGs);
      const corrV2 = spearmanCorrelation(v2Scores, actualPPGs);

      // Metric 2: Score variance
      const statsV1 = describeArray(v1Scores);
      const statsV2 = describeArray(v2Scores);

      // Metric 3: Small-sample sensitivity (players with <5 games)
      const smallSampleV1: number[] = [];
      const smallSampleV2: number[] = [];
      const gamesMap = seasonalData.games.get(season);
      for (let i = 0; i < playerIds.length; i++) {
        const pid = playerIds[i];
        const games = gamesMap?.get(pid) ?? 0;
        if (games > 0 && games < 5) {
          smallSampleV1.push(v1Scores[i]);
          smallSampleV2.push(v2Scores[i]);
        }
      }

      tableRows.push([
        season,
        v1Scores.length,
        corrV1.toFixed(3),
        corrV2.toFixed(3),
        statsV1.stddev,
        statsV2.stddev,
        describeArray(smallSampleV1).mean,
        describeArray(smallSampleV2).mean,
      ]);
    }

    if (tableRows.length > 0) {
      printTable(
        [
          "Season",
          "Players",
          "Corr(v1,PPG)",
          "Corr(v2,PPG)",
          "StdDev(v1)",
          "StdDev(v2)",
          "SmallSample(v1)",
          "SmallSample(v2)",
        ],
        tableRows,
      );
    }
  }

  console.log("\nDone.");
}

run().catch(console.error);
