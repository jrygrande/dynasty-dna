/**
 * Experiment 7: Waiver Grading Validation
 *
 * Hypothesis: Waiver grading correlates positively with MOS, and adding
 * waiver_score to the overall composite improves MOS prediction.
 *
 * Method:
 *   1. Correlate waiver_score against MOS per league-season
 *   2. Build 2-pillar (draft+lineup), 3-pillar (+trade), and 4-pillar
 *      (+waiver) composites and correlate each against MOS
 *   3. Confirm that adding pillars improves prediction
 *
 * Usage: npx tsx scripts/experiments/07-waiver-grading-validation.ts
 */

import { eq, and } from "drizzle-orm";
import {
  runExperiment,
  db,
  schema,
  spearmanCorrelation,
  printTable,
  metric,
  noData,
  round3,
} from "./helpers";
import { computeLeagueMOS } from "../../src/services/outcomeScore";

const METRIC_TYPES = ["draft_score", "trade_score", "waiver_score", "lineup_score"] as const;

runExperiment({
  name: "waiver-grading-validation",
  hypothesis:
    "Waiver grading correlates positively with MOS, and adding waiver_score to the overall composite improves MOS prediction",
  acceptanceCriteria:
    "Waiver-vs-MOS Spearman > 0.1 AND 4-pillar composite beats 2-pillar baseline",
  run: async (ctx) => {
    const families = await ctx.db.select().from(ctx.schema.leagueFamilies);
    if (families.length === 0) return noData("No league families found");

    // Load all roster owners
    const allRosters = await ctx.db
      .select({
        leagueId: ctx.schema.rosters.leagueId,
        rosterId: ctx.schema.rosters.rosterId,
        ownerId: ctx.schema.rosters.ownerId,
      })
      .from(ctx.schema.rosters);

    const rosterToOwner = new Map<string, string>();
    for (const r of allRosters) {
      if (r.ownerId) rosterToOwner.set(`${r.leagueId}:${r.rosterId}`, r.ownerId);
    }

    // Load all family members to get league -> season mapping
    const allMembers = await ctx.db.select().from(ctx.schema.leagueFamilyMembers);
    const leagueToSeason = new Map<string, string>();
    for (const m of allMembers) leagueToSeason.set(m.leagueId, m.season);
    const leagueIds = [...leagueToSeason.keys()];

    if (leagueIds.length === 0) return noData("No leagues found");

    // Load all manager metrics (season-scoped)
    const allMetrics = await ctx.db
      .select()
      .from(ctx.schema.managerMetrics);

    // Group metrics by leagueId -> managerId -> metric -> value
    const metricsByLeague = new Map<string, Map<string, Map<string, number>>>();
    for (const row of allMetrics) {
      if (!row.scope.startsWith("season:")) continue;
      if (!METRIC_TYPES.includes(row.metric as typeof METRIC_TYPES[number])) continue;

      if (!metricsByLeague.has(row.leagueId))
        metricsByLeague.set(row.leagueId, new Map());
      const leagueMap = metricsByLeague.get(row.leagueId)!;

      if (!leagueMap.has(row.managerId))
        leagueMap.set(row.managerId, new Map());
      leagueMap.get(row.managerId)!.set(row.metric, row.value);
    }

    // Compute MOS per league and correlate
    const perPillarCorrs: Record<string, number[]> = {
      draft_score: [],
      trade_score: [],
      waiver_score: [],
      lineup_score: [],
    };
    const compositeCorrs = {
      "2-pillar": [] as number[],
      "3-pillar": [] as number[],
      "4-pillar": [] as number[],
    };

    let leaguesAnalyzed = 0;

    for (const leagueId of leagueIds) {
      const mosScores = await computeLeagueMOS(leagueId, undefined, db);
      if (mosScores.length < 3) continue;

      const leagueMetrics = metricsByLeague.get(leagueId);
      if (!leagueMetrics) continue;

      // Build ownerId -> MOS map
      const ownerMos = new Map<string, number>();
      for (const s of mosScores) {
        const owner = rosterToOwner.get(`${s.leagueId}:${s.rosterId}`);
        if (owner) ownerMos.set(owner, s.mos);
      }
      if (ownerMos.size < 3) continue;

      leaguesAnalyzed++;

      // Per-pillar correlations
      for (const pillar of METRIC_TYPES) {
        const pillarScores: number[] = [];
        const mosArr: number[] = [];
        for (const [managerId, metrics] of leagueMetrics) {
          const score = metrics.get(pillar);
          const mos = ownerMos.get(managerId);
          if (score !== undefined && mos !== undefined) {
            pillarScores.push(score);
            mosArr.push(mos);
          }
        }
        if (pillarScores.length >= 3) {
          perPillarCorrs[pillar].push(spearmanCorrelation(pillarScores, mosArr));
        }
      }

      // Composite correlations
      const composites: { managers: string[]; scores2: number[]; scores3: number[]; scores4: number[]; mos: number[] } = {
        managers: [], scores2: [], scores3: [], scores4: [], mos: [],
      };

      for (const [managerId, metrics] of leagueMetrics) {
        const mos = ownerMos.get(managerId);
        if (mos === undefined) continue;

        const draft = metrics.get("draft_score");
        const lineup = metrics.get("lineup_score");
        const trade = metrics.get("trade_score");
        const waiver = metrics.get("waiver_score");

        // 2-pillar: draft + lineup
        if (draft !== undefined && lineup !== undefined) {
          composites.managers.push(managerId);
          composites.scores2.push((draft + lineup) / 2);
          composites.scores3.push(
            trade !== undefined ? (draft + trade + lineup) / 3 : (draft + lineup) / 2,
          );
          composites.scores4.push(
            trade !== undefined && waiver !== undefined
              ? (draft + trade + waiver + lineup) / 4
              : trade !== undefined
                ? (draft + trade + lineup) / 3
                : (draft + lineup) / 2,
          );
          composites.mos.push(mos);
        }
      }

      if (composites.managers.length >= 3) {
        compositeCorrs["2-pillar"].push(spearmanCorrelation(composites.scores2, composites.mos));
        compositeCorrs["3-pillar"].push(spearmanCorrelation(composites.scores3, composites.mos));
        compositeCorrs["4-pillar"].push(spearmanCorrelation(composites.scores4, composites.mos));
      }
    }

    if (leaguesAnalyzed === 0) return noData("No leagues with sufficient data for correlation");

    // Compute averages
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const avgPillarCorrs: Record<string, number> = {};
    for (const [pillar, corrs] of Object.entries(perPillarCorrs)) {
      avgPillarCorrs[pillar] = avg(corrs);
    }

    const avgCompositeCorrs = {
      "2-pillar": avg(compositeCorrs["2-pillar"]),
      "3-pillar": avg(compositeCorrs["3-pillar"]),
      "4-pillar": avg(compositeCorrs["4-pillar"]),
    };

    // Print results
    ctx.log(`\nLeagues analyzed: ${leaguesAnalyzed}`);

    ctx.log("\n--- Per-Pillar MOS Correlations ---");
    printTable(
      ["Pillar", "Avg Spearman", "Leagues"],
      Object.entries(avgPillarCorrs).map(([p, c]) => [
        p,
        round3(c),
        perPillarCorrs[p].length,
      ]),
    );

    ctx.log("\n--- Composite MOS Correlations ---");
    printTable(
      ["Composite", "Avg Spearman", "Leagues"],
      Object.entries(avgCompositeCorrs).map(([c, v]) => [
        c,
        round3(v),
        compositeCorrs[c as keyof typeof compositeCorrs].length,
      ]),
    );

    // Verdict
    const waiverCorr = avgPillarCorrs["waiver_score"] ?? 0;
    const fourPillar = avgCompositeCorrs["4-pillar"];
    const twoPillar = avgCompositeCorrs["2-pillar"];
    const waiverPositive = waiverCorr > 0.1;
    const fourBeatTwo = fourPillar > twoPillar;

    const verdict = waiverPositive && fourBeatTwo
      ? "confirmed"
      : !waiverPositive && !fourBeatTwo
        ? "rejected"
        : "inconclusive";

    return {
      verdict,
      verdictReason: `Waiver-vs-MOS corr=${round3(waiverCorr)} (${waiverPositive ? ">" : "≤"} 0.1), 4-pillar=${round3(fourPillar)} vs 2-pillar=${round3(twoPillar)} (${fourBeatTwo ? "improved" : "not improved"})`,
      scorecard: {
        primaryMetrics: [
          metric("Waiver-vs-MOS correlation", waiverCorr, "spearman"),
          metric("4-pillar composite correlation", fourPillar, "spearman", { baseline: twoPillar }),
        ],
        secondaryMetrics: [
          metric("Draft-vs-MOS", avgPillarCorrs["draft_score"] ?? 0, "spearman"),
          metric("Trade-vs-MOS", avgPillarCorrs["trade_score"] ?? 0, "spearman"),
          metric("Lineup-vs-MOS", avgPillarCorrs["lineup_score"] ?? 0, "spearman"),
          metric("3-pillar composite", avgCompositeCorrs["3-pillar"], "spearman", { baseline: twoPillar }),
        ],
        guardrailMetrics: [
          metric("Leagues analyzed", leaguesAnalyzed, "count"),
          metric("4-pillar vs 2-pillar", fourPillar - twoPillar, "delta"),
        ],
      },
      metrics: { perPillarCorrs: avgPillarCorrs, compositeCorrs: avgCompositeCorrs },
      rawData: [
        ...Object.entries(avgPillarCorrs).map(([p, c]) => ({
          type: "pillar", name: p, avgCorr: round3(c), leagues: perPillarCorrs[p].length,
        })),
        ...Object.entries(avgCompositeCorrs).map(([c, v]) => ({
          type: "composite", name: c, avgCorr: round3(v), leagues: compositeCorrs[c as keyof typeof compositeCorrs].length,
        })),
      ],
    };
  },
});
