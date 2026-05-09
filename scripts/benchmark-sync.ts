/**
 * Sync benchmark — exercises the REAL syncLeagueFamily() against the dev DB,
 * with a synthetic Sleeper mock.
 *
 * Usage:
 *   npm run bench:sync                    # 3 runs, compare against baseline
 *   npm run bench:sync -- --runs=5
 *   npm run bench:sync -- --update-baseline
 *   npm run bench:sync -- --json          # machine-readable summary on stdout
 *   npm run bench:sync -- --latency=20    # override per-call mock latency (ms)
 *   npm run bench:sync -- --seasons=3
 *
 * What it captures (best-of-N by total wall time):
 *   - total wall time
 *   - api_calls — how many Sleeper requests syncLeagueFamily made
 *   - peak_concurrency — observed max in-flight requests
 *   - db_writes — best-effort row count delta in the dev DB after each run
 *
 * Safety:
 *   The script REFUSES to run unless the resolved DB host looks like a Neon
 *   dev branch (same allowlist convention as `scripts/reset-db.ts`).
 *   Set DATABASE_URL_DEV (off-Vercel resolution) before running.
 *
 * The CI workflow runs this in `--json --check` mode and parses the summary.
 */

// Load env in priority order: .env.development.local > .env.development > .env.local.
// `override: false` keeps any caller-provided env (CI secrets) winning.
import { config as loadEnv } from "dotenv";
import * as fs from "fs";
import * as path from "path";

for (const f of [".env.development.local", ".env.development", ".env.local"]) {
  const p = path.resolve(process.cwd(), f);
  if (fs.existsSync(p)) loadEnv({ path: p, override: false });
}

import { resolveDatabaseUrl, getDb, getSyncDb, schema } from "@/db";
import { sql, inArray } from "drizzle-orm";

import {
  installSleeperMock,
  getMockStats,
  resetMockStats,
} from "./sync-bench-mock";

// ---- CLI parsing ----
interface Args {
  runs: number;
  updateBaseline: boolean;
  json: boolean;
  check: boolean;
  latencyMs: number;
  seasons: number;
  /** ID prefix for synthetic leagues — set per CI run to avoid collisions on a
   *  shared dev branch. Default `bench`. */
  idPrefix: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    runs: 3,
    updateBaseline: false,
    json: false,
    check: false,
    latencyMs: 50,
    seasons: 5,
    idPrefix: process.env.BENCH_ID_PREFIX || "bench",
  };
  for (const a of argv) {
    if (a === "--update-baseline") args.updateBaseline = true;
    else if (a === "--json") args.json = true;
    else if (a === "--check") args.check = true;
    else if (a.startsWith("--runs=")) args.runs = Math.max(1, parseInt(a.slice(7), 10) || 3);
    else if (a.startsWith("--latency=")) args.latencyMs = Math.max(0, parseInt(a.slice(10), 10) || 0);
    else if (a.startsWith("--seasons=")) args.seasons = Math.max(1, parseInt(a.slice(10), 10) || 5);
    else if (a.startsWith("--id-prefix=")) {
      const v = a.slice("--id-prefix=".length).trim();
      if (v) args.idPrefix = v;
    }
  }
  return args;
}

// ---- Dev-host guard (same convention as scripts/reset-db.ts) ----
const DEV_HOST_PATTERNS = [/-dev\./i, /dev-branch/i];

function isDevHost(host: string): boolean {
  if (DEV_HOST_PATTERNS.some((p) => p.test(host))) return true;
  const allowlist = (process.env.NEON_DEV_HOST_ALLOWLIST ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(host.toLowerCase());
}

function assertDevDb(): { host: string; url: string } {
  const { url, source } = resolveDatabaseUrl();
  const host = new URL(url).host;
  if (source !== "DATABASE_URL_DEV" || !isDevHost(host)) {
    console.error("");
    console.error("REFUSING to run benchmark: resolved DB does not look like a dev branch.");
    console.error(`  resolved host: ${host}`);
    console.error(`  resolved from: ${source}`);
    console.error("");
    console.error("Set DATABASE_URL_DEV (in .env.development.local or as an env var) and");
    console.error("either use a host containing '-dev.' / 'dev-branch' or add it to");
    console.error("NEON_DEV_HOST_ALLOWLIST.");
    process.exit(2);
  }
  return { host, url };
}

// ---- DB cleanup for benchmark league IDs ----
async function cleanBenchRows(leagueIds: string[]): Promise<void> {
  const db = getDb();
  // Order matters: delete dependents before parents.
  await db.delete(schema.matchups).where(inArray(schema.matchups.leagueId, leagueIds));
  await db
    .delete(schema.playerScores)
    .where(inArray(schema.playerScores.leagueId, leagueIds));
  await db
    .delete(schema.transactions)
    .where(inArray(schema.transactions.leagueId, leagueIds));
  await db
    .delete(schema.tradedPicks)
    .where(inArray(schema.tradedPicks.leagueId, leagueIds));
  // draft_picks cascades via drafts.
  await db.delete(schema.drafts).where(inArray(schema.drafts.leagueId, leagueIds));
  await db.delete(schema.rosters).where(inArray(schema.rosters.leagueId, leagueIds));
  await db
    .delete(schema.leagueUsers)
    .where(inArray(schema.leagueUsers.leagueId, leagueIds));
  await db
    .delete(schema.syncWatermarks)
    .where(inArray(schema.syncWatermarks.leagueId, leagueIds));
  await db
    .delete(schema.assetEvents)
    .where(inArray(schema.assetEvents.leagueId, leagueIds));
  await db.delete(schema.leagues).where(inArray(schema.leagues.id, leagueIds));
}

async function countBenchRows(leagueIds: string[]): Promise<number> {
  const db = getDb();

  async function countByLeagueId(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    column: any,
  ): Promise<number> {
    const rows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(table)
      .where(inArray(column, leagueIds));
    return Number(rows[0]?.c ?? 0);
  }

  const tasks = [
    countByLeagueId(schema.leagues, schema.leagues.id),
    countByLeagueId(schema.leagueUsers, schema.leagueUsers.leagueId),
    countByLeagueId(schema.rosters, schema.rosters.leagueId),
    countByLeagueId(schema.drafts, schema.drafts.leagueId),
    countByLeagueId(schema.tradedPicks, schema.tradedPicks.leagueId),
    countByLeagueId(schema.transactions, schema.transactions.leagueId),
    countByLeagueId(schema.matchups, schema.matchups.leagueId),
    countByLeagueId(schema.playerScores, schema.playerScores.leagueId),
    countByLeagueId(schema.syncWatermarks, schema.syncWatermarks.leagueId),
  ];
  const counts = await Promise.all(tasks);
  return counts.reduce((a, b) => a + b, 0);
}

// ---- Single benchmark run ----
interface RunResult {
  wallTimeMs: number;
  apiCalls: number;
  peakConcurrency: number;
  dbWrites: number;
  callsByEndpoint: Record<string, number>;
}

async function singleRun(args: Args, leagueIds: string[]): Promise<RunResult> {
  // Clean DB state so each run is "cold sync" against an empty family.
  await cleanBenchRows(leagueIds);
  resetMockStats();

  // Lazy-import sync after env is loaded so the DB client picks up DATABASE_URL_DEV.
  const { syncLeagueFamily } = await import("@/services/sync");

  const t0 = Date.now();
  await syncLeagueFamily(leagueIds, undefined, undefined);
  const wallTimeMs = Date.now() - t0;

  const stats = getMockStats();
  const dbWrites = await countBenchRows(leagueIds);

  return {
    wallTimeMs,
    apiCalls: stats.apiCalls,
    peakConcurrency: stats.peakConcurrency,
    dbWrites,
    callsByEndpoint: stats.callsByEndpoint,
  };
}

import { pickBest, checkAgainstBaseline } from "./bench-helpers";

// ---- Baseline file ----
interface Baseline {
  /** Best-of-N wall-clock floor (ms). Compared with a 20% tolerance. */
  wall_time_ms: number;
  /** Exact API call count. Any change is meaningful and fails CI. */
  api_calls: number;
  /** Observed peak in-flight requests. Documented; not gated. */
  peak_concurrency: number;
  /** Total benchmark rows written across the family. Documented; not gated. */
  db_writes: number;
  /** Description of each metric (for future maintainers). */
  notes: Record<string, string>;
  /** Knobs that produced this baseline. */
  config: {
    seasons: number;
    latency_ms: number;
    runs: number;
  };
  /** ISO timestamp of last update. */
  updated_at: string;
}

const BASELINE_PATH = path.resolve(__dirname, "sync-baseline.json");

function loadBaseline(): Baseline | null {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")) as Baseline;
  } catch (err) {
    console.warn(`Could not parse baseline: ${(err as Error).message}`);
    return null;
  }
}

function writeBaseline(b: Baseline): void {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(b, null, 2) + "\n", "utf-8");
}

// ---- Main ----
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { host } = assertDevDb();

  console.error(`[bench] dev DB host: ${host}`);
  console.error(
    `[bench] config: seasons=${args.seasons} latency=${args.latencyMs}ms runs=${args.runs}`
  );

  const { leagueIds, uninstall } = installSleeperMock({
    seasons: args.seasons,
    latencyMs: args.latencyMs,
    idPrefix: args.idPrefix,
  });

  const runs: RunResult[] = [];
  try {
    for (let i = 0; i < args.runs; i++) {
      console.error(`[bench] run ${i + 1}/${args.runs}…`);
      const r = await singleRun(args, leagueIds);
      runs.push(r);
      console.error(
        `  wall=${r.wallTimeMs}ms api_calls=${r.apiCalls} peak=${r.peakConcurrency} db_writes=${r.dbWrites}`
      );
    }
    // Final cleanup so the dev DB is left clean.
    await cleanBenchRows(leagueIds);
  } finally {
    uninstall();
    // Drain neon WS pool so the script can exit cleanly.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const syncDb = getSyncDb() as any;
      if (typeof syncDb.$client?.end === "function") {
        await syncDb.$client.end();
      }
    } catch {
      /* best-effort */
    }
  }

  // Best-of-N: pick the fastest wall time. Take api/peak/db from the same run.
  const best = pickBest(runs);

  // Sanity: every run should make the same number of API calls. If not, that's
  // a real signal — surface it loudly.
  const distinctCalls = new Set(runs.map((r) => r.apiCalls));
  if (distinctCalls.size > 1) {
    console.warn(
      `[bench] WARNING: api_calls varied across runs: ${Array.from(distinctCalls).join(", ")}`
    );
  }

  const baseline = loadBaseline();
  const summary = {
    wall_time_ms: best.wallTimeMs,
    api_calls: best.apiCalls,
    peak_concurrency: best.peakConcurrency,
    db_writes: best.dbWrites,
    runs_wall_ms: runs.map((r) => r.wallTimeMs),
    config: {
      seasons: args.seasons,
      latency_ms: args.latencyMs,
      runs: args.runs,
    },
    baseline: baseline
      ? {
          wall_time_ms: baseline.wall_time_ms,
          api_calls: baseline.api_calls,
          tolerance_pct: 20,
        }
      : null,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.error("\n--- Summary ---");
    console.error(`Best wall time: ${best.wallTimeMs}ms (of ${runs.map((r) => r.wallTimeMs).join(", ")})`);
    console.error(`API calls:      ${best.apiCalls}`);
    console.error(`Peak concurrency: ${best.peakConcurrency}`);
    console.error(`DB writes:      ${best.dbWrites}`);
    if (baseline) {
      const wallPct = ((best.wallTimeMs / baseline.wall_time_ms) * 100).toFixed(1);
      console.error(
        `Vs baseline:    wall=${wallPct}% api=${best.apiCalls === baseline.api_calls ? "match" : `${best.apiCalls} vs ${baseline.api_calls}`}`
      );
    }
  }

  if (args.updateBaseline) {
    const next: Baseline = {
      wall_time_ms: best.wallTimeMs,
      api_calls: best.apiCalls,
      peak_concurrency: best.peakConcurrency,
      db_writes: best.dbWrites,
      config: {
        seasons: args.seasons,
        latency_ms: args.latencyMs,
        runs: args.runs,
      },
      notes: {
        wall_time_ms:
          "Best-of-N total wall time for syncLeagueFamily across the whole chain. CI fails when wall_time_ms > baseline * 1.20.",
        api_calls:
          "Exact count of Sleeper requests the sync made. Any change (up or down) is meaningful — CI fails on mismatch.",
        peak_concurrency:
          "Observed peak in-flight Sleeper requests. Documented for context; not gated (exact value depends on Node/event-loop scheduling).",
        db_writes:
          "Total bench rows written across the family after sync (leagues + users + rosters + drafts + traded_picks + transactions + matchups + player_scores + sync_watermarks). Documented; not gated.",
      },
      updated_at: new Date().toISOString(),
    };
    writeBaseline(next);
    console.error(`\n[bench] baseline updated -> ${BASELINE_PATH}`);
    return;
  }

  if (args.check) {
    if (!baseline) {
      console.error("\n[bench] no baseline found — re-run with --update-baseline to create one.");
      process.exit(1);
    }

    const result = checkAgainstBaseline(best, {
      wall_time_ms: baseline.wall_time_ms,
      api_calls: baseline.api_calls,
    });

    if (!result.apiOk) {
      console.error(
        `\n[bench] FAIL: api_calls ${result.apiCalls} != baseline ${result.baselineApiCalls}. Sync's API surface changed; review the diff and re-run --update-baseline if intentional.`,
      );
    }
    if (!result.wallOk) {
      console.error(
        `\n[bench] FAIL: wall_time_ms ${result.wallTimeMs} > tolerance ${result.toleranceMs.toFixed(0)}ms (baseline ${result.baselineWallMs} * 1.20).`,
      );
    }
    if (!result.apiOk || !result.wallOk) process.exit(1);
    console.error(
      `\n[bench] PASS — within tolerance${result.withinFloor ? " (under floor; wall comparison skipped)" : ""}.`,
    );
  }
}

main().catch((err) => {
  console.error("[bench] fatal:", err);
  process.exit(1);
});
