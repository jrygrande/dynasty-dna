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

import { eq } from "drizzle-orm";
import {
  rankToProductionValue,
  playerSeasonalPAR,
  computeSeasonalRanks,
} from "../../src/services/gradingCore";
import {
  runExperiment,
  describeArray,
  spearmanCorrelation,
  printTable,
} from "./helpers";

runExperiment({
  name: "par-vs-rank",
  hypothesis:
    "PAR correlates better with PPG than rank-based decay, especially in the mushy middle (ranks 12-30)",
  run: async (ctx) => {
    // Find all league families
    const families = await ctx.db.select().from(ctx.schema.leagueFamilies);
    if (families.length === 0) {
      ctx.log("No league families found.");
      return { metrics: {}, rawData: [] };
    }

    const allTableRows: Record<string, (string | number)[][]> = {};
    const perSeasonCorrelations: Record<
      string,
      { v1: number; v2: number }
    > = {};
    const allV1Corrs: number[] = [];
    const allV2Corrs: number[] = [];

    for (const family of families) {
      ctx.log(`\n--- Family: ${family.name} ---`);

      const members = await ctx.db
        .select()
        .from(ctx.schema.leagueFamilyMembers)
        .where(eq(ctx.schema.leagueFamilyMembers.familyId, family.id));

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

      const tableRows: (string | number)[][] = [];

      for (const season of seasons) {
        const seasonNum = parseInt(season, 10);

        // Collect all players who have both rank and PAR data
        const v1Scores: number[] = [];
        const v2Scores: number[] = [];
        const actualPPGs: number[] = [];
        const playerIds: string[] = [];

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

        const row: (string | number)[] = [
          season,
          v1Scores.length,
          corrV1.toFixed(3),
          corrV2.toFixed(3),
          statsV1.stddev,
          statsV2.stddev,
          describeArray(smallSampleV1).mean,
          describeArray(smallSampleV2).mean,
        ];
        tableRows.push(row);

        perSeasonCorrelations[`${family.name}:${season}`] = { v1: corrV1, v2: corrV2 };
        allV1Corrs.push(corrV1);
        allV2Corrs.push(corrV2);
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
        allTableRows[family.name] = tableRows;
      }
    }

    const avgV1 =
      allV1Corrs.length > 0
        ? Math.round((allV1Corrs.reduce((a, b) => a + b, 0) / allV1Corrs.length) * 1000) / 1000
        : 0;
    const avgV2 =
      allV2Corrs.length > 0
        ? Math.round((allV2Corrs.reduce((a, b) => a + b, 0) / allV2Corrs.length) * 1000) / 1000
        : 0;

    ctx.log(`\nAverage correlation — v1 (rank): ${avgV1}, v2 (PAR): ${avgV2}`);

    return {
      metrics: {
        perSeasonCorrelations,
        averageCorrelationV1: avgV1,
        averageCorrelationV2: avgV2,
        seasonsAnalyzed: allV1Corrs.length,
      },
      rawData: Object.entries(allTableRows).flatMap(([family, rows]) =>
        rows.map((r) => ({
          family,
          season: r[0],
          players: r[1],
          corrV1: r[2],
          corrV2: r[3],
          stddevV1: r[4],
          stddevV2: r[5],
          smallSampleV1: r[6],
          smallSampleV2: r[7],
        })),
      ),
    };
  },
});
