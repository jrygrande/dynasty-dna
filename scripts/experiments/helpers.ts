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
import { execSync } from "child_process";
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
function getGitHash(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function printScorecard(result: ExperimentResult): void {
  const { scorecard, verdict, verdictReason } = result;

  const verdictLabel = verdict.toUpperCase();
  const verdictIcon = verdict === "confirmed" ? "✓" : verdict === "rejected" ? "✗" : "—";
  console.log(`\n  Verdict: ${verdictLabel} ${verdictIcon}`);
  if (verdictReason) console.log(`  ${verdictReason}`);

  if (scorecard.primaryMetrics.length === 0) return;

  const printMetrics = (label: string, metrics: ScorecardMetric[]) => {
    if (metrics.length === 0) return;
    console.log(`\n  ${label}`);
    for (const m of metrics) {
      const parts = [`    ${m.name.padEnd(40)} ${String(m.value).padStart(8)}`];
      if (m.baseline !== undefined) parts.push(`  baseline ${String(m.baseline).padStart(8)}`);
      if (m.lift !== undefined) {
        const pct = Math.round(m.lift * 100);
        const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "—";
        parts.push(`  ${arrow} ${pct > 0 ? "+" : ""}${pct}%`);
      }
      console.log(parts.join(""));
    }
  };

  printMetrics("PRIMARY", scorecard.primaryMetrics);
  printMetrics("SECONDARY", scorecard.secondaryMetrics ?? []);
  printMetrics("GUARDRAIL", scorecard.guardrailMetrics ?? []);
}

export async function runExperiment(def: ExperimentDefinition): Promise<void> {
  const startedAt = new Date();
  const gitHash = getGitHash();

  console.log(`\n=== Experiment: ${def.name} ===`);
  console.log(`Hypothesis: ${def.hypothesis}`);
  console.log(`Acceptance: ${def.acceptanceCriteria}\n`);

  // Merge git hash into config for provenance tracking
  const config = { ...def.config, _gitHash: gitHash };

  // Insert a running record
  const [row] = await db
    .insert(schema.experimentRuns)
    .values({
      name: def.name,
      hypothesis: def.hypothesis,
      acceptanceCriteria: def.acceptanceCriteria,
      config,
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

    console.log(`\n=== COMPLETE: ${def.name} ===`);
    printScorecard(result);
    console.log(`\n  ${elapsed}s · Run ID: ${runId}${gitHash ? ` · ${gitHash}` : ""}`);
  } catch (err) {
    const errorDetail = err instanceof Error ? (err.stack ?? err.message) : String(err);

    await db
      .update(schema.experimentRuns)
      .set({
        status: "failed",
        error: errorDetail,
        finishedAt: new Date(),
      })
      .where(
        eq(schema.experimentRuns.id, runId),
      );

    console.error(`\nExperiment FAILED: ${errorDetail}`);
    throw err;
  }
}

// ============================================================
// Statistical utilities
// ============================================================

/** Round to 3 decimal places */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Build a scorecard metric with automatic lift calculation and rounding */
export function metric(
  name: string,
  value: number,
  unit: string,
  opts?: { baseline?: number; direction?: "higher" | "lower" },
): ScorecardMetric {
  const direction = opts?.direction ?? "higher";
  const baseline = opts?.baseline;
  const lift =
    baseline !== undefined && baseline !== 0
      ? (value - baseline) / Math.abs(baseline)
      : undefined;
  return {
    name,
    value: round3(value),
    baseline: baseline !== undefined ? round3(baseline) : undefined,
    lift,
    unit,
    direction,
  };
}

/** Early return for experiments with no data to analyze */
export function noData(reason: string): ExperimentResult {
  return {
    metrics: {},
    rawData: [],
    verdict: "inconclusive",
    verdictReason: reason,
    scorecard: { primaryMetrics: [] },
  };
}

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
