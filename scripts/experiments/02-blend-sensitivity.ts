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

import { db, schema } from "./helpers";
import { inArray } from "drizzle-orm";
import { describeArray, printTable } from "./helpers";
import {
  productionWeight,
  scoreToGrade,
} from "../../src/services/gradingCore";

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

function shannonEntropy(grades: string[]): number {
  const counts = new Map<string, number>();
  for (const g of grades) {
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  const n = grades.length;
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / n;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

async function run() {
  console.log("=== Experiment: Blend Curve Sensitivity ===\n");

  // Load all trade grades (pre-computed)
  const grades = await db.select().from(schema.tradeGrades);
  if (grades.length === 0) {
    console.log("No trade grades found. Run trade grading first.");
    return;
  }

  // Load trade timestamps
  const txIds = [...new Set(grades.map((g) => g.transactionId))];
  const txBatches: string[][] = [];
  for (let i = 0; i < txIds.length; i += 500) {
    txBatches.push(txIds.slice(i, i + 500));
  }

  const txTimestamps = new Map<string, number>();
  for (const batch of txBatches) {
    const txRows = await db
      .select({ id: schema.transactions.id, createdAt: schema.transactions.createdAt })
      .from(schema.transactions)
      .where(inArray(schema.transactions.id, batch));
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

  for (const bucket of buckets) {
    console.log(`\n--- ${bucket.label} ---`);

    const relevantGrades = grades.filter((g) => {
      const ts = txTimestamps.get(g.transactionId);
      if (!ts) return false;
      const weeks = (Date.now() - ts) / (7 * 24 * 60 * 60 * 1000);
      return weeks >= bucket.minWeeks && weeks < bucket.maxWeeks;
    });

    if (relevantGrades.length < 5) {
      console.log(`  Only ${relevantGrades.length} grades — skipping.`);
      continue;
    }

    const tableRows: (string | number)[][] = [];

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
        Math.round(entropy * 1000) / 1000,
      ]);
    }

    printTable(
      ["Curve", "N", "Mean", "StdDev", "Entropy"],
      tableRows,
    );
  }

  console.log("\nHigher entropy = more spread across grades (better calibration).");
  console.log("Done.");
}

run().catch(console.error);
