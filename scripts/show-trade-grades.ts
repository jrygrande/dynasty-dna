/**
 * Re-grades all trades for the test family and prints detailed diagnostics.
 * Usage: npx tsx scripts/show-trade-grades.ts
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, inArray, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import {
  gradeLeagueTrades,
  resolvePickValue,
  effectiveValue,
  GRADE_CONFIG,
} from "../src/services/tradeGrading";
import { syncFantasyCalcValues } from "../src/services/fantasyCalcSync";

// Patch getDb to use our script's DB connection
import * as dbModule from "../src/db";

const DATABASE_URL = process.env.DATABASE_URL!;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sqlClient = neon(DATABASE_URL);
const db = drizzle(sqlClient, { schema });

// Override getDb for the grading service
(dbModule as any).getDb = () => db;

async function run() {
  console.log("Current GRADE_CONFIG:", JSON.stringify(GRADE_CONFIG, null, 2));

  // Find the family
  const families = await db.select().from(schema.leagueFamilies);
  if (families.length === 0) {
    console.error("No league families found");
    process.exit(1);
  }
  const familyId = families[0].id;
  console.log(`\nUsing family: ${familyId}`);

  // Get family members
  const members = await db
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, familyId));

  const familyLeagueIds = members.map((m) => m.leagueId);
  const leagueSeasonMap = new Map(members.map((m) => [m.leagueId, m.season]));
  console.log(`Family has ${familyLeagueIds.length} seasons`);

  // Detect superflex from first league's roster positions
  const [leagueInfo] = await db
    .select({
      rosterPositions: schema.leagues.rosterPositions,
      totalRosters: schema.leagues.totalRosters,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, familyLeagueIds[0]))
    .limit(1);

  const rosterPositions = (leagueInfo?.rosterPositions as string[]) || [];
  const hasSuperFlex = rosterPositions.includes("SUPER_FLEX");
  console.log(`Format: ${hasSuperFlex ? "SUPERFLEX (numQbs=2)" : "1QB (numQbs=1)"}`);

  // Sync FantasyCalc once for the whole family, then reuse the timestamp
  const syncedAt = await syncFantasyCalcValues(familyLeagueIds[0], { force: true });
  if (!syncedAt) {
    console.error("Failed to sync FantasyCalc values");
    process.exit(1);
  }
  console.log(`FantasyCalc synced once at ${syncedAt.toISOString()}`);

  // Re-grade all leagues (reusing the single sync)
  let totalGraded = 0;
  for (const member of members) {
    const count = await gradeLeagueTrades(member.leagueId, familyId, { syncedAt });
    totalGraded += count;
    console.log(`  Graded ${count} sides in ${member.season} (${member.leagueId})`);
  }
  console.log(`\nTotal graded: ${totalGraded} trade sides`);

  // Load FantasyCalc snapshot for value display (use subquery to avoid timestamp parsing issues)
  const fcSnapshot = new Map<string, number>();
  const fcRows = await db
    .select({
      playerId: schema.fantasyCalcValues.playerId,
      value: schema.fantasyCalcValues.value,
    })
    .from(schema.fantasyCalcValues)
    .where(
      sql`${schema.fantasyCalcValues.fetchedAt} = (select max(${schema.fantasyCalcValues.fetchedAt}) from ${schema.fantasyCalcValues})`,
    );
  for (const r of fcRows) fcSnapshot.set(r.playerId, r.value);
  console.log(`Loaded ${fcSnapshot.size} FantasyCalc values for display`);

  // Build pick resolution infrastructure (mirrors gradeLeagueTrades)
  const leagueRosterCounts = await db
    .select({ id: schema.leagues.id, totalRosters: schema.leagues.totalRosters })
    .from(schema.leagues)
    .where(inArray(schema.leagues.id, familyLeagueIds));
  const rosterCountMap = new Map(leagueRosterCounts.map((l) => [l.id, l.totalRosters || 12]));

  const familyDrafts = await db
    .select({
      id: schema.drafts.id,
      season: schema.drafts.season,
      status: schema.drafts.status,
      type: schema.drafts.type,
      slotToRosterId: schema.drafts.slotToRosterId,
      leagueId: schema.drafts.leagueId,
    })
    .from(schema.drafts)
    .where(inArray(schema.drafts.leagueId, familyLeagueIds));

  const draftsBySeason = new Map<
    string,
    {
      slotToRosterId: Record<string, number> | null;
      draftId: string;
      status: string;
      type: string;
      totalRosters: number;
    }
  >();
  for (const d of familyDrafts) {
    draftsBySeason.set(d.season, {
      slotToRosterId: d.slotToRosterId as Record<string, number> | null,
      draftId: d.id,
      status: d.status || "",
      type: d.type || "snake",
      totalRosters: rosterCountMap.get(d.leagueId) || 12,
    });
  }

  const completedDraftIds = familyDrafts.filter((d) => d.status === "complete").map((d) => d.id);
  const allDraftPicks =
    completedDraftIds.length > 0
      ? await db
          .select({
            draftId: schema.draftPicks.draftId,
            pickNo: schema.draftPicks.pickNo,
            playerId: schema.draftPicks.playerId,
          })
          .from(schema.draftPicks)
          .where(inArray(schema.draftPicks.draftId, completedDraftIds))
      : [];

  const draftPicksMap = new Map<string, Map<number, string>>();
  for (const dp of allDraftPicks) {
    if (!dp.playerId) continue;
    if (!draftPicksMap.has(dp.draftId)) draftPicksMap.set(dp.draftId, new Map());
    draftPicksMap.get(dp.draftId)!.set(dp.pickNo, dp.playerId);
  }

  // Round averages from PICK entries
  const roundAverages = new Map<number, number>();
  {
    const pickValRows = await db
      .select({ playerName: schema.fantasyCalcValues.playerName, value: schema.fantasyCalcValues.value })
      .from(schema.fantasyCalcValues)
      .where(
        and(
          sql`${schema.fantasyCalcValues.fetchedAt} = (select max(${schema.fantasyCalcValues.fetchedAt}) from ${schema.fantasyCalcValues})`,
          eq(schema.fantasyCalcValues.position, "PICK"),
        ),
      );
    const roundGroups = new Map<number, number[]>();
    for (const row of pickValRows) {
      const name = row.playerName || "";
      let round: number | null = null;
      if (name.includes("1st")) round = 1;
      else if (name.includes("2nd")) round = 2;
      else if (name.includes("3rd")) round = 3;
      else if (name.includes("4th")) round = 4;
      else {
        const match = name.match(/(\d+)\.(\d+)/);
        if (match) round = parseInt(match[1], 10);
      }
      if (round !== null) {
        if (!roundGroups.has(round)) roundGroups.set(round, []);
        roundGroups.get(round)!.push(row.value);
      }
    }
    for (const [round, values] of roundGroups) {
      roundAverages.set(round, values.reduce((a, b) => a + b, 0) / values.length);
    }
  }
  if (roundAverages.size === 0) {
    roundAverages.set(1, 6000);
    roundAverages.set(2, 2500);
    roundAverages.set(3, 1000);
    roundAverages.set(4, 250);
  }

  const pickResolver = (pick: { season: string; round: number; roster_id: number }) =>
    resolvePickValue(pick, draftsBySeason, draftPicksMap, fcSnapshot, roundAverages);

  // Now fetch and display the results
  const trades = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        inArray(schema.transactions.leagueId, familyLeagueIds),
        eq(schema.transactions.type, "trade"),
      ),
    )
    .orderBy(sql`${schema.transactions.createdAt} ASC`);

  // Get player names
  const allPlayerIds = new Set<string>();
  for (const t of trades) {
    const adds = (t.adds || {}) as Record<string, number>;
    const drops = (t.drops || {}) as Record<string, number>;
    Object.keys(adds).forEach((id) => allPlayerIds.add(id));
    Object.keys(drops).forEach((id) => allPlayerIds.add(id));
  }
  // Also collect players from resolved picks
  for (const t of trades) {
    const draftPicks = (t.draftPicks || []) as Array<{
      season: string; round: number; roster_id: number;
      previous_owner_id: number; owner_id: number;
    }>;
    for (const dp of draftPicks) {
      const res = pickResolver({ season: dp.season, round: dp.round, roster_id: dp.roster_id });
      if (res.playerId) allPlayerIds.add(res.playerId);
    }
  }

  const playerNames = new Map<string, string>();
  if (allPlayerIds.size > 0) {
    const playerRows = await db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players)
      .where(inArray(schema.players.id, [...allPlayerIds]));
    for (const p of playerRows) playerNames.set(p.id, p.name);
  }

  // Get roster owner names
  const rosterOwnerMap = new Map<string, Map<number, string>>();
  for (const leagueId of familyLeagueIds) {
    const users = await db
      .select()
      .from(schema.leagueUsers)
      .where(eq(schema.leagueUsers.leagueId, leagueId));
    const rosters = await db
      .select()
      .from(schema.rosters)
      .where(eq(schema.rosters.leagueId, leagueId));
    const userMap = new Map(users.map((u) => [u.userId, u.displayName]));
    const rosterMap = new Map<number, string>();
    for (const r of rosters) {
      if (r.ownerId) rosterMap.set(r.rosterId, userMap.get(r.ownerId) || r.ownerId);
    }
    rosterOwnerMap.set(leagueId, rosterMap);
  }

  // Get all trade grades
  const tradeIds = trades.map((t) => t.id);
  const grades =
    tradeIds.length > 0
      ? await db
          .select()
          .from(schema.tradeGrades)
          .where(inArray(schema.tradeGrades.transactionId, tradeIds))
      : [];

  const gradesByTx = new Map<string, typeof grades>();
  for (const g of grades) {
    const existing = gradesByTx.get(g.transactionId) || [];
    existing.push(g);
    gradesByTx.set(g.transactionId, existing);
  }

  // Helper: format player/pick with values
  function fmtPlayer(pid: string): string {
    const name = playerNames.get(pid) || pid;
    const fc = fcSnapshot.get(pid);
    if (fc !== undefined) {
      const eff = effectiveValue(fc);
      return `${name} (fc=${fc}, eff=${Math.round(eff)})`;
    }
    return `${name} (fc=?)`;
  }

  function fmtPick(dp: {
    season: string;
    round: number;
    roster_id: number;
  }): string {
    const res = pickResolver(dp);
    if (res.resolved === "player" && res.playerId) {
      const name = playerNames.get(res.playerId) || res.playerId;
      return `${dp.season} R${dp.round} → ${name} (val=${res.value})`;
    }
    return `${dp.season} R${dp.round} (${res.resolved}=${res.value})`;
  }

  // Print each trade — both sides shown together
  console.log("\n" + "=".repeat(100));
  console.log("TRADE GRADES");
  console.log("=".repeat(100));

  const gradeDistribution: Record<string, number> = {};

  for (const trade of trades) {
    const adds = (trade.adds || {}) as Record<string, number>;
    const drops = (trade.drops || {}) as Record<string, number>;
    const draftPicks = (trade.draftPicks || []) as Array<{
      season: string; round: number; roster_id: number;
      previous_owner_id: number; owner_id: number;
    }>;
    const rosterIds = (trade.rosterIds || []) as number[];
    const rosterMap = rosterOwnerMap.get(trade.leagueId) || new Map();
    const season = leagueSeasonMap.get(trade.leagueId) || "?";
    const tradeDate = trade.createdAt
      ? new Date(trade.createdAt).toISOString().slice(0, 10)
      : "unknown";

    const tGrades = gradesByTx.get(trade.id) || [];

    // Build side info for all rosters
    const sides = rosterIds.map((rosterId) => {
      const manager = rosterMap.get(rosterId) || `Roster ${rosterId}`;

      // Got (received)
      const gotPlayers = Object.entries(adds)
        .filter(([, rid]) => rid === rosterId)
        .map(([pid]) => fmtPlayer(pid));
      const gotPicks = draftPicks
        .filter((dp) => dp.owner_id === rosterId)
        .map((dp) => fmtPick(dp));

      // Sent
      const sentPlayers = Object.entries(drops)
        .filter(([, rid]) => rid === rosterId)
        .map(([pid]) => fmtPlayer(pid));
      const sentPicks = draftPicks
        .filter((dp) => dp.previous_owner_id === rosterId)
        .map((dp) => fmtPick(dp));

      const g = tGrades.find((g) => g.rosterId === rosterId);
      if (g) {
        gradeDistribution[g.grade || "?"] = (gradeDistribution[g.grade || "?"] || 0) + 1;
      }

      return {
        manager,
        got: [...gotPlayers, ...gotPicks],
        sent: [...sentPlayers, ...sentPicks],
        grade: g?.grade || "?",
        blend: g?.blendedScore ?? null,
        val: g?.valueScore ?? null,
        prod: g?.productionScore ?? null,
        prodWeeks: g?.productionWeeks ?? null,
        pw: g?.productionWeight ?? null,
      };
    });

    // Print header
    const pw = sides[0]?.pw;
    const pwStr = pw !== null ? `pw=${(pw! * 100).toFixed(0)}%` : "";
    console.log(`\n┌${"─".repeat(98)}┐`);
    console.log(`│ ${tradeDate} (${season})${" ".repeat(Math.max(0, 88 - season.length - tradeDate.length))}${pwStr} │`);

    // Print each side
    for (let si = 0; si < sides.length; si++) {
      const s = sides[si];
      console.log(`├${"─".repeat(98)}┤`);

      // Manager + grade + scores
      const scoreParts: string[] = [];
      if (s.blend !== null) scoreParts.push(`blend=${s.blend.toFixed(1)}`);
      if (s.val !== null) scoreParts.push(`val=${s.val.toFixed(1)}`);
      if (s.prod !== null) scoreParts.push(`prod=${s.prod.toFixed(1)}(${s.prodWeeks}wk)`);
      else scoreParts.push("prod=N/A");
      const scoreStr = scoreParts.join(" ");

      console.log(`│ ${s.manager}: ${s.grade}  ${scoreStr}${" ".repeat(Math.max(0, 95 - s.manager.length - s.grade.length - scoreStr.length))}│`);

      // Got
      for (let i = 0; i < s.got.length; i++) {
        const prefix = i === 0 ? "  Got:  " : "        ";
        const line = prefix + s.got[i];
        console.log(`│ ${line}${" ".repeat(Math.max(0, 97 - line.length))}│`);
      }
      if (s.got.length === 0) {
        console.log(`│ ${"  Got:  (nothing)"}${" ".repeat(80)}│`);
      }

      // Sent
      for (let i = 0; i < s.sent.length; i++) {
        const prefix = i === 0 ? "  Sent: " : "        ";
        const line = prefix + s.sent[i];
        console.log(`│ ${line}${" ".repeat(Math.max(0, 97 - line.length))}│`);
      }
      if (s.sent.length === 0) {
        console.log(`│ ${"  Sent: (nothing)"}${" ".repeat(80)}│`);
      }
    }

    console.log(`└${"─".repeat(98)}┘`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("GRADE DISTRIBUTION");
  console.log("=".repeat(80));
  for (const g of ["A+", "A", "B+", "B", "C", "D", "D-", "F"]) {
    const count = gradeDistribution[g] || 0;
    const bar = "█".repeat(count);
    console.log(`  ${g.padEnd(3)} ${String(count).padStart(3)} ${bar}`);
  }
}

run().catch(console.error);
