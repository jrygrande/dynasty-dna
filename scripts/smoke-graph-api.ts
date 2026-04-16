/**
 * Smoke test for GET /api/leagues/:familyId/graph.
 *
 * Usage:
 *   FAMILY_ID=<uuid or rootLeagueId> [BASE_URL=http://localhost:3000] \
 *   npx tsx scripts/smoke-graph-api.ts
 *
 * Prints basic counts (nodes, edges, trades, multi-hop chains, picks traded)
 * and a non-zero-exit on clear failures. Safe to run with no env — prints
 * usage and exits 0 so it never blocks CI.
 */

async function main() {
  const familyId = process.env.FAMILY_ID;
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";

  if (!familyId) {
    console.log("[smoke-graph-api] FAMILY_ID not set — nothing to do.");
    console.log("Usage:");
    console.log("  FAMILY_ID=<id> [BASE_URL=http://localhost:3000] npx tsx scripts/smoke-graph-api.ts");
    process.exit(0);
    return;
  }

  const url = `${baseUrl}/api/leagues/${encodeURIComponent(familyId)}/graph`;
  console.log(`[smoke-graph-api] GET ${url}`);

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error("[smoke-graph-api] fetch failed:", err);
    process.exit(1);
    return;
  }

  if (!res.ok) {
    console.error(`[smoke-graph-api] non-2xx: ${res.status} ${res.statusText}`);
    const body = await res.text();
    console.error(body.slice(0, 500));
    process.exit(1);
    return;
  }

  const data = (await res.json()) as {
    nodes: unknown[];
    edges: unknown[];
    stats: {
      totalTrades: number;
      totalDraftPicks: number;
      totalEdges: number;
      totalNodes: number;
      multiHopChains: number;
      picksTraded: number;
    };
    seasons: string[];
    managers: Array<{ userId: string; displayName: string }>;
  };

  console.log("[smoke-graph-api] response summary:");
  console.log(`  nodes:           ${data.nodes.length}`);
  console.log(`  edges:           ${data.edges.length}`);
  console.log(`  totalTrades:     ${data.stats.totalTrades}`);
  console.log(`  totalDraftPicks: ${data.stats.totalDraftPicks}`);
  console.log(`  multiHopChains:  ${data.stats.multiHopChains}`);
  console.log(`  picksTraded:     ${data.stats.picksTraded}`);
  console.log(`  seasons:         ${data.seasons.join(", ")}`);
  console.log(`  managers:        ${data.managers.length}`);

  if (data.nodes.length === 0 && data.edges.length === 0) {
    console.warn("[smoke-graph-api] WARN: empty response — family may need a sync.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke-graph-api] unexpected error:", err);
  process.exit(1);
});
