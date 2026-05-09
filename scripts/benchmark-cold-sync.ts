/**
 * Cold-sync benchmark — read-only.
 *
 * Discovers the league family chain via Sleeper API and times every API call
 * a real cold sync would make, without writing to the DB. Gives us:
 *   - calls per season
 *   - wall time per season at Sleeper's rate limit
 *   - projected total cold-sync time for 1/3/5 season families
 *
 * Usage:  npx tsx scripts/benchmark-cold-sync.ts <leagueId>
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const SLEEPER = "https://api.sleeper.app/v1";
const REGULAR_WEEKS = 18;

let totalCalls = 0;
let totalApiMs = 0;

async function get(url: string): Promise<any> {
  const t0 = performance.now();
  const res = await fetch(url);
  const ms = performance.now() - t0;
  totalCalls++;
  totalApiMs += ms;
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`${res.status} ${url}`);
  }
  return res.json();
}

async function discoverFamily(leagueId: string): Promise<any[]> {
  const chain: any[] = [];
  let cur: string | null = leagueId;
  while (cur) {
    const league: any = await get(`${SLEEPER}/league/${cur}`);
    if (!league) break;
    chain.unshift(league);
    cur = league.previous_league_id || null;
  }
  return chain;
}

async function benchmarkSeason(league: any) {
  const t0 = performance.now();
  const before = totalCalls;

  // Pulls a real cold sync makes per season (modeled from src/services/sync.ts):
  await get(`${SLEEPER}/league/${league.league_id}/users`);
  await get(`${SLEEPER}/league/${league.league_id}/rosters`);

  const drafts: any[] = (await get(`${SLEEPER}/league/${league.league_id}/drafts`)) || [];
  for (const d of drafts) {
    await get(`${SLEEPER}/draft/${d.draft_id}/picks`);
    await get(`${SLEEPER}/draft/${d.draft_id}/traded_picks`);
  }
  await get(`${SLEEPER}/league/${league.league_id}/traded_picks`);

  // Transactions: 1 call per regular-season week
  for (let w = 1; w <= REGULAR_WEEKS; w++) {
    await get(`${SLEEPER}/league/${league.league_id}/transactions/${w}`);
  }
  // Matchups: 1 call per week
  for (let w = 1; w <= REGULAR_WEEKS; w++) {
    await get(`${SLEEPER}/league/${league.league_id}/matchups/${w}`);
  }
  // Winners bracket
  await get(`${SLEEPER}/league/${league.league_id}/winners_bracket`);

  const calls = totalCalls - before;
  const ms = performance.now() - t0;
  return { season: league.season, leagueId: league.league_id, calls, ms };
}

async function main() {
  const leagueId = process.argv[2];
  if (!leagueId) {
    console.error("Usage: npx tsx scripts/benchmark-cold-sync.ts <leagueId>");
    process.exit(1);
  }

  console.log(`\nDiscovering family chain for ${leagueId}…`);
  const chain = await discoverFamily(leagueId);
  console.log(
    `Family has ${chain.length} season(s):`,
    chain.map((l: any) => `${l.season}=${l.league_id}`).join(", ")
  );

  console.log(`\nTiming each season's cold-sync API calls…\n`);
  const perSeason: any[] = [];
  for (const league of chain) {
    const r = await benchmarkSeason(league);
    perSeason.push(r);
    console.log(`  ${r.season}: ${r.calls} calls, ${(r.ms / 1000).toFixed(2)}s`);
  }

  const sumCalls = perSeason.reduce((a, r) => a + r.calls, 0);
  const sumMs = perSeason.reduce((a, r) => a + r.ms, 0);
  const avgCalls = sumCalls / perSeason.length;
  const avgMs = sumMs / perSeason.length;

  console.log(`\n— Summary —`);
  console.log(`Total calls (full family cold sync): ${sumCalls}`);
  console.log(`Total wall time (sequential): ${(sumMs / 1000).toFixed(2)}s`);
  console.log(`Avg calls/season: ${avgCalls.toFixed(0)}`);
  console.log(`Avg wall time/season: ${(avgMs / 1000).toFixed(2)}s`);
  console.log(`\nProjected cold-sync wall time at this league's API latency:`);
  console.log(`  1 season: ~${(avgMs / 1000).toFixed(1)}s`);
  console.log(`  3 seasons: ~${((avgMs * 3) / 1000).toFixed(1)}s`);
  console.log(`  5 seasons: ~${((avgMs * 5) / 1000).toFixed(1)}s`);
  console.log(
    `\nAt Sleeper's 1000 RPM (15 RPS practical), pure rate-limit floor for ${sumCalls} calls = ${(sumCalls / 15).toFixed(1)}s\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
