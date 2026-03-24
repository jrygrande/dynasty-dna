/**
 * Experiment 2: Blend Curve Sensitivity
 *
 * Hypothesis: Context-specific blend curves produce better-calibrated
 * grade distributions than the single universal curve.
 *
 * Method:
 *   For trades at known time horizons, compute grades under:
 *     - v1 universal curve
 *     - v2 trade-specific curve
 *     - 3 additional variant curves (faster/slower ramp)
 *   Measure grade distribution entropy — best curve produces the most
 *   normal distribution (not collapsed into all-A's or all-F's).
 *
 * Usage: npx tsx scripts/experiments/02-blend-sensitivity.ts
 */

import { inArray } from "drizzle-orm";
import {
  productionWeight,
  scoreToGrade,
} from "../../src/services/gradingCore";
import {
  runExperiment,
  describeArray,
  shannonEntropy,
  printTable,
  metric,
  noData,
} from "./helpers";

// v1 universal curve (original)
function v1Weight(weeksElapsed: number): number {
  const years = weeksElapsed / 52;
  if (years <= 0) return 0;
  return 0.9 * (years / (years + 0.8));
}

// Variant curves for comparison (not in BLEND_PROFILES — experiment-only)
const VARIANT_CURVES: Record<string, Array<{ weeks: number; weight: number }>> = {
  "fast-ramp": [
    { weeks: 0, weight: 0 },
    { weeks: 2, weight: 0.2 },
    { weeks: 8, weight: 0.5 },
    { weeks: 26, weight: 0.8 },
    { weeks: 52, weight: 0.9 },
    { weeks: 260, weight: 0.95 },
  ],
  "slow-ramp": [
    { weeks: 0, weight: 0 },
    { weeks: 8, weight: 0 },
    { weeks: 26, weight: 0.15 },
    { weeks: 52, weight: 0.4 },
    { weeks: 156, weight: 0.7 },
    { weeks: 260, weight: 0.9 },
  ],
};

function interpolateVariant(
  weeksElapsed: number,
  breakpoints: Array<{ weeks: number; weight: number }>,
): number {
  if (weeksElapsed <= 0) return breakpoints[0].weight;
  for (let i = 1; i < breakpoints.length; i++) {
    if (weeksElapsed <= breakpoints[i].weeks) {
      const prev = breakpoints[i - 1];
      const curr = breakpoints[i];
      const t = (weeksElapsed - prev.weeks) / (curr.weeks - prev.weeks);
      return prev.weight + t * (curr.weight - prev.weight);
    }
  }
  return breakpoints[breakpoints.length - 1].weight;
}

runExperiment({
  name: "blend-sensitivity",
  hypothesis:
    "Context-specific blend curves produce better-calibrated grade distributions than the single universal curve",
  acceptanceCriteria:
    "v2-trade entropy exceeds v1-universal entropy in the majority of time-horizon buckets",
  run: async (ctx) => {
    // Load all trade grades (pre-computed)
    const grades = await ctx.db.select().from(ctx.schema.tradeGrades);
    if (grades.length === 0) {
      ctx.log("No trade grades found. Run trade grading first.");
      return noData("No trade grades found");
    }

    // Load trade timestamps
    const txIds = [...new Set(grades.map((g) => g.transactionId))];
    const txBatches: string[][] = [];
    for (let i = 0; i < txIds.length; i += 500) {
      txBatches.push(txIds.slice(i, i + 500));
    }

    const txTimestamps = new Map<string, number>();
    for (const batch of txBatches) {
      const txRows = await ctx.db
        .select({ id: ctx.schema.transactions.id, createdAt: ctx.schema.transactions.createdAt })
        .from(ctx.schema.transactions)
        .where(inArray(ctx.schema.transactions.id, batch));
      for (const tx of txRows) {
        if (tx.createdAt) txTimestamps.set(tx.id, tx.createdAt);
      }
    }

    // Time horizon buckets
    const buckets = [
      { label: "1-4 weeks", minWeeks: 1, maxWeeks: 4 },
      { label: "1-3 months", minWeeks: 4, maxWeeks: 13 },
      { label: "3-12 months", minWeeks: 13, maxWeeks: 52 },
      { label: "1-2 years", minWeeks: 52, maxWeeks: 104 },
      { label: "2+ years", minWeeks: 104, maxWeeks: Infinity },
    ];

    const curveNames = ["v1-universal", "v2-trade", ...Object.keys(VARIANT_CURVES)];

    const perBucketEntropy: Record<string, Record<string, number>> = {};
    const allRawRows: { bucket: string; curve: string; n: number; mean: number; stddev: number; entropy: number }[] = [];

    for (const bucket of buckets) {
      ctx.log(`\n--- ${bucket.label} ---`);

      const relevantGrades = grades.filter((g) => {
        const ts = txTimestamps.get(g.transactionId);
        if (!ts) return false;
        const weeks = (Date.now() - ts) / (7 * 24 * 60 * 60 * 1000);
        return weeks >= bucket.minWeeks && weeks < bucket.maxWeeks;
      });

      if (relevantGrades.length < 5) {
        ctx.log(`  Only ${relevantGrades.length} grades — skipping.`);
        continue;
      }

      const tableRows: (string | number)[][] = [];
      const bucketEntropy: Record<string, number> = {};

      for (const curveName of curveNames) {
        const blendedScores: number[] = [];
        const letterGrades: string[] = [];

        for (const g of relevantGrades) {
          const ts = txTimestamps.get(g.transactionId)!;
          const weeks = (Date.now() - ts) / (7 * 24 * 60 * 60 * 1000);

          let pw: number;
          if (curveName === "v1-universal") {
            pw = v1Weight(weeks);
          } else if (curveName === "v2-trade") {
            pw = productionWeight(weeks, "trade");
          } else {
            pw = interpolateVariant(weeks, VARIANT_CURVES[curveName]);
          }

          const vs = g.valueScore ?? 50;
          const ps = g.productionScore ?? 50;
          const score = (1 - pw) * vs + pw * ps;

          blendedScores.push(score);
          letterGrades.push(scoreToGrade(score));
        }

        const stats = describeArray(blendedScores);
        const entropy = shannonEntropy(letterGrades);

        tableRows.push([
          curveName,
          relevantGrades.length,
          stats.mean,
          stats.stddev,
          entropy,
        ]);

        bucketEntropy[curveName] = entropy;

        allRawRows.push({
          bucket: bucket.label,
          curve: curveName,
          n: relevantGrades.length,
          mean: stats.mean,
          stddev: stats.stddev,
          entropy,
        });
      }

      printTable(
        ["Curve", "N", "Mean", "StdDev", "Entropy"],
        tableRows,
      );

      perBucketEntropy[bucket.label] = bucketEntropy;
    }

    ctx.log("\nHigher entropy = more spread across grades (better calibration).");

    // Evaluate verdict: count buckets where v2-trade beats v1-universal
    const bucketLabels = Object.keys(perBucketEntropy);
    let v2Wins = 0;
    for (const label of bucketLabels) {
      const bucket = perBucketEntropy[label];
      if (bucket["v2-trade"] > bucket["v1-universal"]) v2Wins++;
    }
    const verdict = bucketLabels.length === 0
      ? "inconclusive" as const
      : v2Wins > bucketLabels.length / 2
        ? "confirmed" as const
        : v2Wins === Math.floor(bucketLabels.length / 2)
          ? "inconclusive" as const
          : "rejected" as const;
    const verdictReason = `v2-trade higher entropy in ${v2Wins}/${bucketLabels.length} buckets`;

    // Build scorecard from per-bucket entropy averages
    const v2Avg = bucketLabels.length > 0
      ? bucketLabels.reduce((sum, l) => sum + (perBucketEntropy[l]["v2-trade"] ?? 0), 0) / bucketLabels.length
      : 0;
    const v1Avg = bucketLabels.length > 0
      ? bucketLabels.reduce((sum, l) => sum + (perBucketEntropy[l]["v1-universal"] ?? 0), 0) / bucketLabels.length
      : 0;

    return {
      verdict,
      verdictReason,
      scorecard: {
        primaryMetrics: [
          metric("v2-trade avg entropy", v2Avg, "bits", { baseline: v1Avg }),
        ],
        secondaryMetrics: [
          metric("Buckets where v2 wins", v2Wins, "count", { baseline: bucketLabels.length }),
        ],
      },
      metrics: {
        perBucketEntropy,
      },
      rawData: allRawRows,
    };
  },
});
