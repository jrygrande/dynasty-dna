/**
 * Experiment runner harness.
 *
 * Provides DB connection, stat utilities, and a `runExperiment()` function
 * that persists results to the `experiment_runs` table and prints to console.
 *
 * Usage:
 *   import { runExperiment, db, schema } from "./helpers";
 *   runExperiment({
 *     name: "par-vs-rank",
 *     hypothesis: "PAR correlates better with PPG than rank-based decay",
 *     run: async (ctx) => { ... return { metrics, rawData }; },
 *   });
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";

const DATABASE_URL = process.env.DATABASE_URL!;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sqlClient = neon(DATABASE_URL);
export const db = drizzle(sqlClient, { schema });
export { schema };

// Patch getDb for service imports
import * as dbModule from "../../src/db";
(dbModule as Record<string, unknown>).getDb = () => db;

// ============================================================
// Experiment runner
// ============================================================

export interface ExperimentDefinition {
  name: string;
  hypothesis: string;
  acceptanceCriteria: string;
  config?: Record<string, unknown>;
  familyId?: string;
  run: (ctx: ExperimentContext) => Promise<ExperimentResult>;
}

export interface ExperimentContext {
  db: typeof db;
  schema: typeof schema;
  /** Log a message to console (also captured in output) */
  log: (msg: string) => void;
}

export interface ScorecardMetric {
  name: string;
  value: number;
  baseline?: number;
  lift?: number;
  unit: string;
  direction: "higher" | "lower";
}

export interface Scorecard {
  primaryMetrics: ScorecardMetric[];
  secondaryMetrics?: ScorecardMetric[];
  guardrailMetrics?: ScorecardMetric[];
}

export interface ExperimentResult {
  /** Structured metrics for comparison across runs */
  metrics: Record<string, unknown>;
  /** Optional detailed per-item data for drill-down */
  rawData?: unknown[];
  /** Experiment verdict: did the hypothesis hold? */
  verdict: "confirmed" | "rejected" | "inconclusive";
  /** Plain-English explanation of the verdict */
  verdictReason: string;
  /** Structured scorecard for the UI */
  scorecard: Scorecard;
}

/**
 * Run an experiment: execute the run function, persist results to DB,
 * and print a summary to console.
 */
export async function runExperiment(def: ExperimentDefinition): Promise<void> {
  const startedAt = new Date();
  console.log(`\n=== Experiment: ${def.name} ===`);
  console.log(`Hypothesis: ${def.hypothesis}\n`);

  // Insert a running record
  const [row] = await db
    .insert(schema.experimentRuns)
    .values({
      name: def.name,
      hypothesis: def.hypothesis,
      acceptanceCriteria: def.acceptanceCriteria,
      config: def.config ?? null,
      familyId: def.familyId ?? null,
      status: "running",
      startedAt,
    })
    .returning({ id: schema.experimentRuns.id });

  const runId = row.id;
  const logs: string[] = [];

  const ctx: ExperimentContext = {
    db,
    schema,
    log: (msg: string) => {
      console.log(msg);
      logs.push(msg);
    },
  };

  try {
    const result = await def.run(ctx);

    // Persist success
    const finishedAt = new Date();
    const elapsed = ((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1);

    await db
      .update(schema.experimentRuns)
      .set({
        status: "success",
        metrics: result.metrics,
        rawData: result.rawData ?? null,
        verdict: result.verdict,
        verdictReason: result.verdictReason,
        scorecard: result.scorecard,
        finishedAt,
      })
      .where(
        eq(schema.experimentRuns.id, runId),
      );

    console.log(`\n--- Results ---`);
    console.log(JSON.stringify(result.metrics, null, 2));
    console.log(`\nCompleted in ${elapsed}s. Run ID: ${runId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    await db
      .update(schema.experimentRuns)
      .set({
        status: "failed",
        error: errorMsg,
        finishedAt: new Date(),
      })
      .where(
        eq(schema.experimentRuns.id, runId),
      );

    console.error(`\nExperiment FAILED: ${errorMsg}`);
    throw err;
  }
}

// ============================================================
// Statistical utilities
// ============================================================

/** Descriptive stats for a numeric array */
export function describeArray(values: number[]): {
  mean: number;
  median: number;
  stddev: number;
  min: number;
  max: number;
  count: number;
} {
  if (values.length === 0) {
    return { mean: 0, median: 0, stddev: 0, min: 0, max: 0, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
  const variance =
    sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / sorted.length;
  return {
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    stddev: Math.round(Math.sqrt(variance) * 100) / 100,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: sorted.length,
  };
}

/** Spearman rank correlation between two arrays */
export function spearmanCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const n = x.length;

  const rank = (arr: number[]): number[] => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    for (let i = 0; i < n; i++) {
      ranks[sorted[i].i] = i + 1;
    }
    return ranks;
  };

  const rx = rank(x);
  const ry = rank(y);

  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    sumD2 += (rx[i] - ry[i]) ** 2;
  }

  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

/** Shannon entropy of a categorical distribution */
export function shannonEntropy(values: string[]): number {
  const counts = new Map<string, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const n = values.length;
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / n;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return Math.round(entropy * 1000) / 1000;
}

/** Print a comparison table to console */
export function printTable(
  headers: string[],
  rows: (string | number)[][],
): void {
  const colWidths = headers.map((h, i) =>
    Math.max(
      h.length,
      ...rows.map((r) => String(r[i]).length),
    ),
  );

  const sep = colWidths.map((w) => "-".repeat(w + 2)).join("+");
  const fmtRow = (r: (string | number)[]) =>
    r.map((v, i) => ` ${String(v).padEnd(colWidths[i])} `).join("|");

  console.log(fmtRow(headers));
  console.log(sep);
  for (const row of rows) {
    console.log(fmtRow(row));
  }
}
