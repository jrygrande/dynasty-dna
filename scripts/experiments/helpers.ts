/**
 * Shared helpers for experiment scripts.
 * Sets up DB connection and provides common utilities.
 *
 * Usage: import { db, schema, setupDb } from "./helpers";
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
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

/** Stats for a numeric array */
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

/** Print a comparison table */
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
