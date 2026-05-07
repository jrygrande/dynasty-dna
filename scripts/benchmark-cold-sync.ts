/**
 * Cold-sync benchmark — read-only.
 *
 * Discovers the league family chain via Sleeper API and times every API call
 * a real cold sync would make, without writing to the DB. Gives us:
 *   - calls per season
 *   - wall time per season at Sleeper's rate limit
 *   - projected total cold-sync time for 1/3/5 season families
 *
 * Modes:
 *   live (default) — hits api.sleeper.app
 *     Usage:  npx tsx scripts/benchmark-cold-sync.ts <leagueId>
 *
 *   --fixture <path> — replays recorded responses from a JSON fixture map.
 *     Usage:  npx tsx scripts/benchmark-cold-sync.ts <leagueId> --fixture scripts/fixtures/sync-benchmark-fixture.json
 *     The fixture file is a flat object: { "<url>": <responseBody | null> }.
 *     Used by CI so the benchmark is hermetic (no live network).
 *
 *   --record <path> — live mode that also writes every response into a fixture file.
 *     Usage:  npx tsx scripts/benchmark-cold-sync.ts <leagueId> --record scripts/fixtures/sync-benchmark-fixture.json
 *
 *   --json — emit a structured JSON summary to stdout (for CI comparison).
 *     The script's normal human-readable output is routed to stderr in this mode.
 */

import { config } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";

config({ path: ".env.local" });

const SLEEPER = "https://api.sleeper.app/v1";
const REGULAR_WEEKS = 18;

// ---------------------------------------------------------------------------
// Fetch indirection — swappable for fixture replay & tests.
// ---------------------------------------------------------------------------

export interface FetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type FetchImpl = (url: string) => Promise<FetchResponse>;

export const liveFetch: FetchImpl = async (url) => {
  const res = await fetch(url);
  return {
    ok: res.ok,
    status: res.status,
    json: () => res.json() as Promise<unknown>,
  };
};

/**
 * Build a fixture-backed fetch from a URL→body map. Unknown URLs throw, so
 * gaps in the recording are loud and obvious in CI.
 */
export function makeFixtureFetch(fixtureMap: Record<string, unknown>): FetchImpl {
  return async (url: string) => {
    if (!Object.prototype.hasOwnProperty.call(fixtureMap, url)) {
      throw new Error(`Fixture missing entry for URL: ${url}`);
    }
    const body = fixtureMap[url];
    if (body === null) {
      // Recorded 404 — match liveFetch's "ok=false, status=404" shape so the
      // benchmark's null-on-404 logic still works.
      return { ok: false, status: 404, json: async () => null };
    }
    return { ok: true, status: 200, json: async () => body };
  };
}

/**
 * Recording wrapper: delegates to a real fetch but captures responses into a
 * mutable map for later serialization.
 */
export function makeRecordingFetch(
  inner: FetchImpl,
  recording: Record<string, unknown>,
): FetchImpl {
  return async (url) => {
    const res = await inner(url);
    if (res.ok) {
      const body = await res.json();
      recording[url] = body;
      return { ok: true, status: res.status, json: async () => body };
    }
    if (res.status === 404) {
      recording[url] = null;
    }
    return res;
  };
}

// ---------------------------------------------------------------------------
// Benchmark core — reusable from tests.
// ---------------------------------------------------------------------------

export interface BenchmarkContext {
  fetchImpl: FetchImpl;
  totalCalls: number;
  totalApiMs: number;
}

export interface SeasonResult {
  season: string;
  leagueId: string;
  calls: number;
  wall_time_ms: number;
}

export interface BenchmarkSummary {
  leagueId: string;
  seasons: SeasonResult[];
  total_calls: number;
  wall_time_ms: number;
  avg_calls_per_season: number;
  avg_wall_time_ms_per_season: number;
}

export function makeContext(fetchImpl: FetchImpl): BenchmarkContext {
  return { fetchImpl, totalCalls: 0, totalApiMs: 0 };
}

async function get(ctx: BenchmarkContext, url: string): Promise<unknown> {
  const t0 = performance.now();
  const res = await ctx.fetchImpl(url);
  const ms = performance.now() - t0;
  ctx.totalCalls++;
  ctx.totalApiMs += ms;
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`${res.status} ${url}`);
  }
  return res.json();
}

export async function discoverFamily(ctx: BenchmarkContext, leagueId: string): Promise<any[]> {
  const chain: any[] = [];
  let cur: string | null = leagueId;
  while (cur) {
    const league = (await get(ctx, `${SLEEPER}/league/${cur}`)) as any;
    if (!league) break;
    chain.unshift(league);
    cur = league.previous_league_id || null;
  }
  return chain;
}

export async function benchmarkSeason(ctx: BenchmarkContext, league: any): Promise<SeasonResult> {
  const t0 = performance.now();
  const before = ctx.totalCalls;

  // Pulls a real cold sync makes per season (modeled from src/services/sync.ts):
  await get(ctx, `${SLEEPER}/league/${league.league_id}/users`);
  await get(ctx, `${SLEEPER}/league/${league.league_id}/rosters`);

  const drafts = ((await get(ctx, `${SLEEPER}/league/${league.league_id}/drafts`)) as any[]) || [];
  for (const d of drafts) {
    await get(ctx, `${SLEEPER}/draft/${d.draft_id}/picks`);
    await get(ctx, `${SLEEPER}/draft/${d.draft_id}/traded_picks`);
  }
  await get(ctx, `${SLEEPER}/league/${league.league_id}/traded_picks`);

  // Transactions: 1 call per regular-season week
  for (let w = 1; w <= REGULAR_WEEKS; w++) {
    await get(ctx, `${SLEEPER}/league/${league.league_id}/transactions/${w}`);
  }
  // Matchups: 1 call per week
  for (let w = 1; w <= REGULAR_WEEKS; w++) {
    await get(ctx, `${SLEEPER}/league/${league.league_id}/matchups/${w}`);
  }
  // Winners bracket
  await get(ctx, `${SLEEPER}/league/${league.league_id}/winners_bracket`);

  return {
    season: league.season,
    leagueId: league.league_id,
    calls: ctx.totalCalls - before,
    wall_time_ms: performance.now() - t0,
  };
}

export async function runBenchmark(
  fetchImpl: FetchImpl,
  leagueId: string,
): Promise<BenchmarkSummary> {
  const ctx = makeContext(fetchImpl);
  const chain = await discoverFamily(ctx, leagueId);
  const seasons: SeasonResult[] = [];
  for (const league of chain) {
    seasons.push(await benchmarkSeason(ctx, league));
  }
  const sumCalls = seasons.reduce((a, r) => a + r.calls, 0);
  const sumMs = seasons.reduce((a, r) => a + r.wall_time_ms, 0);
  return {
    leagueId,
    seasons,
    total_calls: sumCalls,
    wall_time_ms: sumMs,
    avg_calls_per_season: seasons.length ? sumCalls / seasons.length : 0,
    avg_wall_time_ms_per_season: seasons.length ? sumMs / seasons.length : 0,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  leagueId?: string;
  fixturePath?: string;
  recordPath?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fixture") {
      out.fixturePath = argv[++i];
    } else if (a === "--record") {
      out.recordPath = argv[++i];
    } else if (a === "--json") {
      out.json = true;
    } else if (!out.leagueId) {
      out.leagueId = a;
    }
  }
  return out;
}

function logHuman(stream: NodeJS.WriteStream, msg: string) {
  stream.write(msg + "\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.json ? process.stderr : process.stdout;

  if (!args.leagueId) {
    process.stderr.write(
      "Usage: npx tsx scripts/benchmark-cold-sync.ts <leagueId> [--fixture <path>] [--record <path>] [--json]\n",
    );
    process.exit(1);
  }

  let fetchImpl: FetchImpl;
  let recording: Record<string, unknown> | null = null;

  if (args.fixturePath) {
    const raw = await fs.readFile(args.fixturePath, "utf8");
    const fixtureMap = JSON.parse(raw) as Record<string, unknown>;
    fetchImpl = makeFixtureFetch(fixtureMap);
    logHuman(out, `[fixture] using ${args.fixturePath} (${Object.keys(fixtureMap).length} entries)`);
  } else if (args.recordPath) {
    recording = {};
    fetchImpl = makeRecordingFetch(liveFetch, recording);
    logHuman(out, `[record] live mode, will write fixture to ${args.recordPath}`);
  } else {
    fetchImpl = liveFetch;
  }

  logHuman(out, `\nDiscovering family chain for ${args.leagueId}…`);
  const summary = await runBenchmark(fetchImpl, args.leagueId);
  logHuman(
    out,
    `Family has ${summary.seasons.length} season(s): ` +
      summary.seasons.map((s) => `${s.season}=${s.leagueId}`).join(", "),
  );

  logHuman(out, `\nTiming each season's cold-sync API calls…\n`);
  for (const r of summary.seasons) {
    logHuman(out, `  ${r.season}: ${r.calls} calls, ${(r.wall_time_ms / 1000).toFixed(2)}s`);
  }

  logHuman(out, `\n— Summary —`);
  logHuman(out, `Total calls (full family cold sync): ${summary.total_calls}`);
  logHuman(out, `Total wall time (sequential): ${(summary.wall_time_ms / 1000).toFixed(2)}s`);
  logHuman(out, `Avg calls/season: ${summary.avg_calls_per_season.toFixed(0)}`);
  logHuman(
    out,
    `Avg wall time/season: ${(summary.avg_wall_time_ms_per_season / 1000).toFixed(2)}s`,
  );

  if (recording && args.recordPath) {
    await fs.mkdir(path.dirname(args.recordPath), { recursive: true });
    await fs.writeFile(
      args.recordPath,
      JSON.stringify(recording, null, 2) + "\n",
      "utf8",
    );
    logHuman(
      out,
      `\n[record] wrote ${Object.keys(recording).length} entries to ${args.recordPath}`,
    );
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  }
}

// Only run when invoked directly (not when imported by tests).
const isDirectRun = (() => {
  try {
    return require.main === module;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
