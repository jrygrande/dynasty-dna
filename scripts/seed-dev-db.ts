/**
 * Seed the dev Neon branch with one representative league family copied from
 * prod. Idempotent — re-running deletes existing rows for the seeded family
 * before re-inserting (within a transaction).
 *
 * Wiring:
 *   - Source (read-only)  -> DATABASE_URL_PROD_READ
 *   - Destination (write) -> DATABASE_URL  (scoped by `dotenv -e .env.development`)
 *
 * Usage:
 *   # Required: opt-in flag and prod read URL
 *   DATABASE_URL_PROD_READ='postgresql://...prod...' \
 *     npm run db:dev:seed -- --from-prod
 *
 *   # Optional: pick a specific family by root league id; defaults to the
 *   # demo-eligible family (or the most-recent family if none is flagged).
 *   npm run db:dev:seed -- --from-prod --root-league-id=<league_id>
 *
 * Safety:
 *   - Bails if dest URL appears to point at the prod branch (heuristic on
 *     hostname). Prevents foot-guns when `.env.development` is misconfigured.
 *   - Requires --from-prod explicitly. No silent prod reads.
 */
import "dotenv/config";
import { neon, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema";

type Args = {
  fromProd: boolean;
  rootLeagueId: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { fromProd: false, rootLeagueId: null };
  for (const a of argv.slice(2)) {
    if (a === "--from-prod") args.fromProd = true;
    else if (a.startsWith("--root-league-id=")) {
      args.rootLeagueId = a.slice("--root-league-id=".length).trim() || null;
    }
  }
  return args;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.fromProd) {
    console.error(
      "Refusing to run without --from-prod. This script reads prod data and writes to the dev DB; pass the flag explicitly to confirm intent."
    );
    process.exit(1);
  }

  const destUrl = process.env.DATABASE_URL;
  const sourceUrl = process.env.DATABASE_URL_PROD_READ;

  if (!destUrl) {
    console.error(
      "DATABASE_URL is not set. Run via `npm run db:dev:seed` so .env.development is loaded."
    );
    process.exit(1);
  }
  if (!sourceUrl) {
    console.error(
      "DATABASE_URL_PROD_READ is not set. Export it (or put it in .env.development) before running."
    );
    process.exit(1);
  }
  if (hostOf(destUrl) === hostOf(sourceUrl)) {
    console.error(
      `Aborting: source and destination point at the same host (${hostOf(destUrl)}). Verify .env.development DATABASE_URL points at the dev branch.`
    );
    process.exit(1);
  }

  console.log(`Source (prod, read):  ${hostOf(sourceUrl)}`);
  console.log(`Dest   (dev, write): ${hostOf(destUrl)}`);

  const sourceSql = neon(sourceUrl, { fetchOptions: { cache: "no-store" } });
  const sourceDb = drizzleHttp(sourceSql, { schema });

  // 1. Pick the family to copy.
  let family = args.rootLeagueId
    ? (
        await sourceDb
          .select()
          .from(schema.leagueFamilies)
          .where(eq(schema.leagueFamilies.rootLeagueId, args.rootLeagueId))
          .limit(1)
      )[0]
    : (
        await sourceDb
          .select()
          .from(schema.leagueFamilies)
          .where(eq(schema.leagueFamilies.demoEligible, true))
          .limit(1)
      )[0];

  if (!family) {
    // Fallback: most recently created family.
    const fallback = await sourceDb
      .select()
      .from(schema.leagueFamilies)
      .limit(1);
    family = fallback[0];
  }

  if (!family) {
    console.error("No league families found in source DB. Nothing to seed.");
    process.exit(1);
  }

  console.log(
    `Seeding family: ${family.name} (id=${family.id}, root=${family.rootLeagueId})`
  );

  // 2. Read all rows for this family from source.
  const members = await sourceDb
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, family.id));
  const leagueIds = members.map((m) => m.leagueId);

  if (leagueIds.length === 0) {
    console.error("Family has no member leagues. Nothing to seed.");
    process.exit(1);
  }

  const [
    leagues,
    users,
    rosters,
    transactions,
    drafts,
    tradedPicks,
    matchups,
    playerScores,
    syncWatermarks,
  ] = await Promise.all([
    sourceDb
      .select()
      .from(schema.leagues)
      .where(inArray(schema.leagues.id, leagueIds)),
    sourceDb
      .select()
      .from(schema.leagueUsers)
      .where(inArray(schema.leagueUsers.leagueId, leagueIds)),
    sourceDb
      .select()
      .from(schema.rosters)
      .where(inArray(schema.rosters.leagueId, leagueIds)),
    sourceDb
      .select()
      .from(schema.transactions)
      .where(inArray(schema.transactions.leagueId, leagueIds)),
    sourceDb
      .select()
      .from(schema.drafts)
      .where(inArray(schema.drafts.leagueId, leagueIds)),
    sourceDb
      .select()
      .from(schema.tradedPicks)
      .where(inArray(schema.tradedPicks.leagueId, leagueIds)),
    sourceDb
      .select()
      .from(schema.matchups)
      .where(inArray(schema.matchups.leagueId, leagueIds)),
    sourceDb
      .select()
      .from(schema.playerScores)
      .where(inArray(schema.playerScores.leagueId, leagueIds)),
    sourceDb
      .select()
      .from(schema.syncWatermarks)
      .where(inArray(schema.syncWatermarks.leagueId, leagueIds)),
  ]);

  const draftIds = drafts.map((d) => d.id);
  const draftPicks = draftIds.length
    ? await sourceDb
        .select()
        .from(schema.draftPicks)
        .where(inArray(schema.draftPicks.draftId, draftIds))
    : [];

  const assetEvents = await sourceDb
    .select()
    .from(schema.assetEvents)
    .where(inArray(schema.assetEvents.leagueId, leagueIds));

  // Pull the players referenced by these leagues so FK-free analytics still
  // resolve. Players is a global table; we copy only the relevant subset.
  const playerIds = new Set<string>();
  for (const r of rosters) {
    const arr = (r.players as string[] | null) ?? [];
    for (const id of arr) playerIds.add(id);
    const starters = (r.starters as string[] | null) ?? [];
    for (const id of starters) playerIds.add(id);
  }
  for (const e of assetEvents) {
    if (e.playerId) playerIds.add(e.playerId);
  }
  for (const p of playerScores) playerIds.add(p.playerId);
  for (const dp of draftPicks) {
    if (dp.playerId) playerIds.add(dp.playerId);
  }

  const playerIdsArr = Array.from(playerIds);
  const players = playerIdsArr.length
    ? await sourceDb
        .select()
        .from(schema.players)
        .where(inArray(schema.players.id, playerIdsArr))
    : [];

  console.log("Source counts:", {
    leagues: leagues.length,
    users: users.length,
    rosters: rosters.length,
    transactions: transactions.length,
    drafts: drafts.length,
    draftPicks: draftPicks.length,
    tradedPicks: tradedPicks.length,
    matchups: matchups.length,
    playerScores: playerScores.length,
    assetEvents: assetEvents.length,
    players: players.length,
    syncWatermarks: syncWatermarks.length,
  });

  // 3. Write to dest within a transaction (delete-then-reinsert for
  //    idempotency). Use ws driver for transactional writes.
  const destPool = new Pool({ connectionString: destUrl });
  const destDb = drizzleWs(destPool, { schema });

  try {
    await destDb.transaction(async (tx) => {
      // Delete existing rows for this family (cascade handles
      // children where FKs declare onDelete:"cascade").
      await tx
        .delete(schema.leagueFamilyMembers)
        .where(eq(schema.leagueFamilyMembers.familyId, family!.id));
      await tx
        .delete(schema.leagueFamilies)
        .where(eq(schema.leagueFamilies.id, family!.id));
      await tx
        .delete(schema.leagues)
        .where(inArray(schema.leagues.id, leagueIds));
      // asset_events and sync_watermarks have no FK to leagues — clean explicitly.
      if (leagueIds.length) {
        await tx
          .delete(schema.assetEvents)
          .where(inArray(schema.assetEvents.leagueId, leagueIds));
        await tx
          .delete(schema.matchups)
          .where(inArray(schema.matchups.leagueId, leagueIds));
        await tx
          .delete(schema.playerScores)
          .where(inArray(schema.playerScores.leagueId, leagueIds));
        await tx
          .delete(schema.syncWatermarks)
          .where(
            and(inArray(schema.syncWatermarks.leagueId, leagueIds))
          );
      }

      // Re-insert. Order: parents before children (FKs are validated
      // at end-of-transaction in PG, but keeping order makes this
      // legible).
      if (players.length) {
        // Players is global — onConflictDoUpdate would be ideal, but a
        // simple delete-by-id-then-insert is cleaner and only touches
        // the subset we care about.
        await tx
          .delete(schema.players)
          .where(inArray(schema.players.id, playerIdsArr));
        await tx.insert(schema.players).values(players);
      }
      if (leagues.length) await tx.insert(schema.leagues).values(leagues);
      await tx.insert(schema.leagueFamilies).values(family!);
      if (members.length)
        await tx.insert(schema.leagueFamilyMembers).values(members);
      if (users.length) await tx.insert(schema.leagueUsers).values(users);
      if (rosters.length) await tx.insert(schema.rosters).values(rosters);
      if (drafts.length) await tx.insert(schema.drafts).values(drafts);
      if (draftPicks.length)
        await tx.insert(schema.draftPicks).values(draftPicks);
      if (tradedPicks.length)
        await tx.insert(schema.tradedPicks).values(tradedPicks);
      if (transactions.length)
        await tx.insert(schema.transactions).values(transactions);
      if (assetEvents.length)
        await tx.insert(schema.assetEvents).values(assetEvents);
      if (matchups.length) await tx.insert(schema.matchups).values(matchups);
      if (playerScores.length)
        await tx.insert(schema.playerScores).values(playerScores);
      if (syncWatermarks.length)
        await tx.insert(schema.syncWatermarks).values(syncWatermarks);
    });
    console.log("Seed complete.");
  } finally {
    await destPool.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
