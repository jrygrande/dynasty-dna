/**
 * Experiment 6: Quality × Quantity Blend Sensitivity
 *
 * Hypothesis: The recommended α values (trade=0.50, draft=0.60, waiver=0.40)
 * produce better MOS correlation than pure quality averages (α=1.0).
 *
 * Method:
 *   For each grading pillar, compute manager scores under different α values
 *   (0.0 to 1.0) and Spearman-correlate each against MOS. The α that maximizes
 *   correlation is the optimal blend for that pillar.
 *
 * Usage: npx tsx scripts/experiments/06-quality-x-quantity-blend.ts
 */

import { eq, inArray } from "drizzle-orm";
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
import {
  normalizeWithinLeague,
  QUALITY_WEIGHTS,
} from "../../src/services/gradingCore";

const ALPHA_VALUES = [0.0, 0.2, 0.4, 0.5, 0.6, 0.8, 1.0];

interface PillarConfig {
  pillar: string;
  recommendedAlpha: number;
  gradeTable: "tradeGrades" | "draftGrades" | "waiverGrades";
  qualityField: "blendedScore";
  parField: "rawPAR";
}

const PILLARS: PillarConfig[] = [
  { pillar: "trade_score", recommendedAlpha: QUALITY_WEIGHTS.trade_score, gradeTable: "tradeGrades", qualityField: "blendedScore", parField: "rawPAR" },
  { pillar: "draft_score", recommendedAlpha: QUALITY_WEIGHTS.draft_score, gradeTable: "draftGrades", qualityField: "blendedScore", parField: "rawPAR" },
  { pillar: "waiver_score", recommendedAlpha: QUALITY_WEIGHTS.waiver_score, gradeTable: "waiverGrades", qualityField: "blendedScore", parField: "rawPAR" },
];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

runExperiment({
  name: "quality-x-quantity-blend",
  hypothesis:
    "The recommended α values (trade=0.50, draft=0.60, waiver=0.40) produce better MOS correlation than pure quality averages (α=1.0)",
  acceptanceCriteria:
    "Recommended α beats α=1.0 in Spearman correlation for ≥2 of 3 pillars",
  config: { alphaValues: ALPHA_VALUES, pillars: PILLARS.map((p) => p.pillar) },
  run: async (ctx) => {
    // Load all league families and members
    const families = await ctx.db.select().from(ctx.schema.leagueFamilies);
    if (families.length === 0) return noData("No league families found");

    const allMembers = await ctx.db.select().from(ctx.schema.leagueFamilyMembers);
    const leagueToSeason = new Map<string, string>();
    for (const m of allMembers) leagueToSeason.set(m.leagueId, m.season);
    const leagueIds = [...leagueToSeason.keys()];

    if (leagueIds.length === 0) return noData("No leagues found");

    // Load roster owners for matching grades to MOS
    const allRosters = await ctx.db
      .select({
        leagueId: ctx.schema.rosters.leagueId,
        rosterId: ctx.schema.rosters.rosterId,
        ownerId: ctx.schema.rosters.ownerId,
      })
      .from(ctx.schema.rosters);

    const rosterToOwner = new Map<string, string>(); // "leagueId:rosterId" -> ownerId
    for (const r of allRosters) {
      if (r.ownerId) rosterToOwner.set(`${r.leagueId}:${r.rosterId}`, r.ownerId);
    }

    // Compute MOS per league
    const mosByLeague = new Map<string, Map<string, number>>(); // leagueId -> ownerId -> mos
    for (const lid of leagueIds) {
      const mosScores = await computeLeagueMOS(lid, undefined, db);
      if (mosScores.length === 0) continue;
      const ownerMos = new Map<string, number>();
      for (const s of mosScores) {
        const owner = rosterToOwner.get(`${s.leagueId}:${s.rosterId}`);
        if (owner) ownerMos.set(owner, s.mos);
      }
      if (ownerMos.size >= 3) mosByLeague.set(lid, ownerMos);
    }

    if (mosByLeague.size === 0) return noData("No leagues with sufficient MOS data");

    // Results per pillar per alpha
    const results: Record<string, Record<number, number>> = {}; // pillar -> alpha -> avg spearman
    const tableRows: (string | number)[][] = [];
    let pillarsWhereRecommendedBeatsPure = 0;

    for (const pillarCfg of PILLARS) {
      ctx.log(`\n--- Pillar: ${pillarCfg.pillar} (recommended α=${pillarCfg.recommendedAlpha}) ---`);
      results[pillarCfg.pillar] = {};

      // Load grade rows for this pillar
      const gradeRows = await loadGradeRows(ctx, pillarCfg, leagueIds, rosterToOwner);
      if (gradeRows.size === 0) {
        ctx.log("  No grade data found");
        continue;
      }

      // For each alpha, compute blended scores and correlate with MOS
      for (const alpha of ALPHA_VALUES) {
        const correlations: number[] = [];

        for (const [leagueId, ownerMos] of mosByLeague) {
          const leagueGrades = gradeRows.get(leagueId);
          if (!leagueGrades || leagueGrades.size === 0) continue;

          // Compute blended scores at this alpha
          const managerScores = computeBlendedScores(leagueGrades, alpha);
          if (managerScores.size < 3) continue;

          // Match managers with MOS
          const scoreArr: number[] = [];
          const mosArr: number[] = [];
          for (const [ownerId, score] of managerScores) {
            const mos = ownerMos.get(ownerId);
            if (mos !== undefined) {
              scoreArr.push(score);
              mosArr.push(mos);
            }
          }

          if (scoreArr.length >= 3) {
            correlations.push(spearmanCorrelation(scoreArr, mosArr));
          }
        }

        const avgCorr = correlations.length > 0
          ? correlations.reduce((a, b) => a + b, 0) / correlations.length
          : 0;
        results[pillarCfg.pillar][alpha] = avgCorr;
        ctx.log(`  α=${alpha.toFixed(1)}: avg Spearman=${round3(avgCorr)} (${correlations.length} leagues)`);
      }

      // Check if recommended beats pure average
      const recCorr = results[pillarCfg.pillar][pillarCfg.recommendedAlpha] ?? 0;
      const pureCorr = results[pillarCfg.pillar][1.0] ?? 0;
      if (recCorr > pureCorr) pillarsWhereRecommendedBeatsPure++;

      // Find optimal alpha
      let bestAlpha = 1.0;
      let bestCorr = -1;
      for (const [a, c] of Object.entries(results[pillarCfg.pillar])) {
        if (c > bestCorr) {
          bestCorr = c;
          bestAlpha = Number(a);
        }
      }

      tableRows.push([
        pillarCfg.pillar,
        pillarCfg.recommendedAlpha,
        round3(recCorr),
        round3(pureCorr),
        bestAlpha,
        round3(bestCorr),
      ]);
    }

    if (tableRows.length > 0) {
      ctx.log("\n--- Summary ---");
      printTable(
        ["Pillar", "Rec α", "Rec Corr", "Pure Avg Corr", "Best α", "Best Corr"],
        tableRows,
      );
    }

    const verdict = tableRows.length === 0
      ? "inconclusive"
      : pillarsWhereRecommendedBeatsPure >= 2
        ? "confirmed"
        : "rejected";

    const pureAvgCorrs = PILLARS.map((p) => results[p.pillar]?.[1.0] ?? 0);
    const recCorrs = PILLARS.map((p) => results[p.pillar]?.[p.recommendedAlpha] ?? 0);

    return {
      verdict,
      verdictReason: `Recommended α beat pure average in ${pillarsWhereRecommendedBeatsPure}/3 pillars`,
      scorecard: {
        primaryMetrics: PILLARS.map((p, i) =>
          metric(`${p.pillar} corr (α=${p.recommendedAlpha})`, recCorrs[i], "spearman", {
            baseline: pureAvgCorrs[i],
          }),
        ),
        secondaryMetrics: PILLARS.map((p) => {
          const pillarResults = results[p.pillar] ?? {};
          const bestEntry = Object.entries(pillarResults).sort(([, a], [, b]) => b - a)[0];
          return metric(`${p.pillar} optimal α`, bestEntry ? Number(bestEntry[0]) : 0, "α");
        }),
      },
      metrics: results,
      rawData: tableRows.map((r) => ({
        pillar: r[0],
        recommendedAlpha: r[1],
        recommendedCorr: r[2],
        pureAvgCorr: r[3],
        bestAlpha: r[4],
        bestCorr: r[5],
      })),
    };
  },
});

// ============================================================
// Helpers
// ============================================================

type ManagerGrades = Map<string, { totalQuality: number; totalRawPAR: number; count: number }>;

async function loadGradeRows(
  ctx: { db: typeof db; schema: typeof schema },
  cfg: PillarConfig,
  leagueIds: string[],
  rosterToOwner: Map<string, string>,
): Promise<Map<string, ManagerGrades>> {
  const result = new Map<string, ManagerGrades>();

  if (cfg.gradeTable === "tradeGrades") {
    const rows = await ctx.db
      .select({
        transactionId: ctx.schema.tradeGrades.transactionId,
        rosterId: ctx.schema.tradeGrades.rosterId,
        blendedScore: ctx.schema.tradeGrades.blendedScore,
        rawPAR: ctx.schema.tradeGrades.rawPAR,
      })
      .from(ctx.schema.tradeGrades);

    // Need transaction -> leagueId mapping
    const txIds = [...new Set(rows.map((r) => r.transactionId))];
    if (txIds.length === 0) return result;
    const txRows = await ctx.db
      .select({ id: ctx.schema.transactions.id, leagueId: ctx.schema.transactions.leagueId })
      .from(ctx.schema.transactions)
      .where(inArray(ctx.schema.transactions.id, txIds));
    const txLeague = new Map(txRows.map((t) => [t.id, t.leagueId]));

    for (const row of rows) {
      const leagueId = txLeague.get(row.transactionId);
      if (!leagueId) continue;
      const ownerId = rosterToOwner.get(`${leagueId}:${row.rosterId}`);
      if (!ownerId) continue;
      if (!result.has(leagueId)) result.set(leagueId, new Map());
      const mgr = result.get(leagueId)!;
      if (!mgr.has(ownerId)) mgr.set(ownerId, { totalQuality: 0, totalRawPAR: 0, count: 0 });
      const agg = mgr.get(ownerId)!;
      agg.totalQuality += row.blendedScore ?? 0;
      agg.totalRawPAR += row.rawPAR ?? 0;
      agg.count++;
    }
  } else if (cfg.gradeTable === "draftGrades") {
    const rows = await ctx.db
      .select({
        draftId: ctx.schema.draftGrades.draftId,
        rosterId: ctx.schema.draftGrades.rosterId,
        blendedScore: ctx.schema.draftGrades.blendedScore,
        playerProduction: ctx.schema.draftGrades.playerProduction,
      })
      .from(ctx.schema.draftGrades);

    // Need draft -> leagueId mapping
    const draftIds = [...new Set(rows.map((r) => r.draftId))];
    if (draftIds.length === 0) return result;
    const draftRows = await ctx.db
      .select({ id: ctx.schema.drafts.id, leagueId: ctx.schema.drafts.leagueId })
      .from(ctx.schema.drafts)
      .where(inArray(ctx.schema.drafts.id, draftIds));
    const draftLeague = new Map(draftRows.map((d) => [d.id, d.leagueId]));

    for (const row of rows) {
      const leagueId = draftLeague.get(row.draftId);
      if (!leagueId) continue;
      const ownerId = rosterToOwner.get(`${leagueId}:${row.rosterId}`);
      if (!ownerId) continue;
      if (!result.has(leagueId)) result.set(leagueId, new Map());
      const mgr = result.get(leagueId)!;
      if (!mgr.has(ownerId)) mgr.set(ownerId, { totalQuality: 0, totalRawPAR: 0, count: 0 });
      const agg = mgr.get(ownerId)!;
      agg.totalQuality += row.blendedScore ?? 0;
      agg.totalRawPAR += row.playerProduction ?? 0;
      agg.count++;
    }
  } else if (cfg.gradeTable === "waiverGrades") {
    const rows = await ctx.db
      .select({
        transactionId: ctx.schema.waiverGrades.transactionId,
        rosterId: ctx.schema.waiverGrades.rosterId,
        blendedScore: ctx.schema.waiverGrades.blendedScore,
        rawPAR: ctx.schema.waiverGrades.rawPAR,
      })
      .from(ctx.schema.waiverGrades);

    const txIds = [...new Set(rows.map((r) => r.transactionId))];
    if (txIds.length === 0) return result;
    const txRows = await ctx.db
      .select({ id: ctx.schema.transactions.id, leagueId: ctx.schema.transactions.leagueId })
      .from(ctx.schema.transactions)
      .where(inArray(ctx.schema.transactions.id, txIds));
    const txLeague = new Map(txRows.map((t) => [t.id, t.leagueId]));

    for (const row of rows) {
      const leagueId = txLeague.get(row.transactionId);
      if (!leagueId) continue;
      const ownerId = rosterToOwner.get(`${leagueId}:${row.rosterId}`);
      if (!ownerId) continue;
      if (!result.has(leagueId)) result.set(leagueId, new Map());
      const mgr = result.get(leagueId)!;
      if (!mgr.has(ownerId)) mgr.set(ownerId, { totalQuality: 0, totalRawPAR: 0, count: 0 });
      const agg = mgr.get(ownerId)!;
      agg.totalQuality += row.blendedScore ?? 0;
      agg.totalRawPAR += row.rawPAR ?? 0;
      agg.count++;
    }
  }

  return result;
}

function computeBlendedScores(
  leagueGrades: ManagerGrades,
  alpha: number,
): Map<string, number> {
  const entries = Array.from(leagueGrades.entries()).filter(
    ([, agg]) => agg.count > 0,
  );
  if (entries.length === 0) return new Map();

  const rawPARValues = entries.map(([, agg]) => agg.totalRawPAR);
  const normalizedPAR = normalizeWithinLeague(rawPARValues);

  const scores = new Map<string, number>();
  for (let i = 0; i < entries.length; i++) {
    const [ownerId, agg] = entries[i];
    const avgQuality = agg.totalQuality / agg.count;
    const quantityScore = normalizedPAR[i];
    const score = clamp(alpha * avgQuality + (1 - alpha) * quantityScore, 0, 100);
    scores.set(ownerId, score);
  }
  return scores;
}
