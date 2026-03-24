/**
 * Experiment 1: PAR vs Rank-Based Production
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
  db,
  schema,
  describeArray,
  spearmanCorrelation,
  printTable,
  metric,
  round3,
  noData,
} from "./helpers";
import { computeLeagueMOS } from "../../src/services/outcomeScore";

runExperiment({
  name: "par-vs-rank",
  hypothesis:
    "PAR correlates better with PPG than rank-based decay, especially in the mushy middle (ranks 12-30)",
  acceptanceCriteria:
    "Average PAR correlation with PPG exceeds rank-based correlation across all seasons",
  run: async (ctx) => {
    // Find all league families
    const families = await ctx.db.select().from(ctx.schema.leagueFamilies);
    if (families.length === 0) {
      ctx.log("No league families found.");
      return noData("No league families found");
    }

    const allTableRows: Record<string, (string | number)[][]> = {};
    const perSeasonCorrelations: Record<
      string,
      { v1: number; v2: number }
    > = {};
    const allV1Corrs: number[] = [];
    const allV2Corrs: number[] = [];

    // Store per-family data for reuse in MOS correlation section
    const familySeasonalData = new Map<string, Awaited<ReturnType<typeof computeSeasonalRanks>>>();
    const familyMembers = new Map<string, { leagueId: string; season: string }[]>();

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

      // Cache for MOS correlation section below
      familySeasonalData.set(family.id, seasonalData);
      familyMembers.set(family.id, members.map((m) => ({ leagueId: m.leagueId, season: m.season })));

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
        ? round3(allV1Corrs.reduce((a, b) => a + b, 0) / allV1Corrs.length)
        : 0;
    const avgV2 =
      allV2Corrs.length > 0
        ? round3(allV2Corrs.reduce((a, b) => a + b, 0) / allV2Corrs.length)
        : 0;

    ctx.log(`\nAverage correlation — v1 (rank): ${avgV1}, v2 (PAR): ${avgV2}`);

    // MOS correlation: for each league, compute MOS and correlate with
    // the average production score of rostered players under each method
    ctx.log("\n--- MOS Correlation ---");
    const mosCorrelations: Record<string, { v1: number; v2: number }> = {};

    for (const family of families) {
      const members = familyMembers.get(family.id) ?? [];
      const cachedSeasonalData = familySeasonalData.get(family.id);
      if (!cachedSeasonalData || members.length === 0) continue;

      for (const member of members) {
        const leagueMOS = await computeLeagueMOS(member.leagueId, undefined, db);
        if (leagueMOS.length === 0) continue;

        // Get production scores per roster under v1 and v2
        const rosterV1 = new Map<number, number[]>();
        const rosterV2 = new Map<number, number[]>();

        const leagueScores = await ctx.db
          .select()
          .from(ctx.schema.playerScores)
          .where(eq(ctx.schema.playerScores.leagueId, member.leagueId));

        for (const ps of leagueScores) {
          const position = cachedSeasonalData.positions.get(ps.playerId);
          if (!position) continue;

          const rankKey = `${member.season}:${position}`;
          const rankMap = cachedSeasonalData.ranks.get(rankKey);
          const rank = rankMap?.get(ps.playerId);
          if (rank === undefined) continue;

          const awMap = cachedSeasonalData.activeWeeks.get(member.season);
          const activeWeekCount = awMap?.get(ps.playerId) ?? 0;

          const v1Score = rankToProductionValue(rank, activeWeekCount, position);
          const v2Score = playerSeasonalPAR(
            ps.playerId,
            parseInt(member.season, 10),
            parseInt(member.season, 10),
            cachedSeasonalData,
          );

          if (!rosterV1.has(ps.rosterId)) rosterV1.set(ps.rosterId, []);
          if (!rosterV2.has(ps.rosterId)) rosterV2.set(ps.rosterId, []);
          rosterV1.get(ps.rosterId)!.push(v1Score);
          rosterV2.get(ps.rosterId)!.push(v2Score);
        }

        // Build arrays for correlation with MOS
        const mosVals: number[] = [];
        const v1Avgs: number[] = [];
        const v2Avgs: number[] = [];

        for (const mosEntry of leagueMOS) {
          const v1Arr = rosterV1.get(mosEntry.rosterId);
          const v2Arr = rosterV2.get(mosEntry.rosterId);
          if (!v1Arr || !v2Arr || v1Arr.length === 0) continue;

          mosVals.push(mosEntry.mos);
          v1Avgs.push(v1Arr.reduce((a, b) => a + b, 0) / v1Arr.length);
          v2Avgs.push(v2Arr.reduce((a, b) => a + b, 0) / v2Arr.length);
        }

        if (mosVals.length >= 8) {
          const corrV1MOS = spearmanCorrelation(v1Avgs, mosVals);
          const corrV2MOS = spearmanCorrelation(v2Avgs, mosVals);
          const key = `${family.name}:${member.season}`;
          mosCorrelations[key] = {
            v1: round3(corrV1MOS),
            v2: round3(corrV2MOS),
            n: mosVals.length,
          };
          ctx.log(`  ${key} (n=${mosVals.length}): v1=${corrV1MOS.toFixed(3)}, v2=${corrV2MOS.toFixed(3)}`);
        }
      }
    }

    const liftPct = avgV1 !== 0 ? Math.abs(avgV2 - avgV1) / Math.abs(avgV1) : 0;
    const verdict = liftPct < 0.01 ? "inconclusive" as const
      : avgV2 > avgV1 ? "confirmed" as const
      : "rejected" as const;
    const verdictReason = `PAR avg correlation ${avgV2.toFixed(3)} vs rank ${avgV1.toFixed(3)} across ${allV1Corrs.length} seasons`;

    return {
      verdict,
      verdictReason,
      scorecard: {
        primaryMetrics: [
          metric("PAR avg correlation with PPG", avgV2, "correlation", { baseline: avgV1 }),
        ],
        secondaryMetrics: [
          metric("Seasons analyzed", allV1Corrs.length, "count"),
        ],
      },
      metrics: {
        perSeasonCorrelations,
        averageCorrelationV1: avgV1,
        averageCorrelationV2: avgV2,
        seasonsAnalyzed: allV1Corrs.length,
        mosCorrelations,
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
