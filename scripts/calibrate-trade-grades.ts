/**
 * Calibration script for trade grading engine.
 *
 * 1. Fetches FantasyCalc values (directly from API) and inserts into DB
 * 2. Fetches slot_to_roster_id for all drafts (from Sleeper API)
 * 3. Resolves past draft picks to actual drafted players
 * 4. Runs value scoring with real data across multiple config variants
 * 5. Outputs per-trade diagnostics and distribution stats
 * 6. Writes docs/trade-grade-calibration.md
 *
 * Usage:
 *   npx tsx scripts/calibrate-trade-grades.ts
 *
 * Requires DATABASE_URL in environment (use .env or .env.local).
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, inArray, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import * as fs from "fs";
import * as path from "path";

const DATABASE_URL = process.env.DATABASE_URL!;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sqlClient = neon(DATABASE_URL);
const db = drizzle(sqlClient, { schema });

// ============================================================
// FantasyCalc API (inline to avoid path alias issues in scripts)
// ============================================================

interface FantasyCalcPlayer {
  player: {
    name: string;
    position: string;
    maybeTeam: string | null;
    sleeperId: string | null;
  };
  value: number;
  overallRank: number;
  positionRank: number;
}

async function fetchFantasyCalcValues(opts: {
  numQbs?: number;
  numTeams?: number;
  ppr?: number;
} = {}): Promise<FantasyCalcPlayer[]> {
  const params = new URLSearchParams({
    isDynasty: "true",
    numQbs: String(opts.numQbs ?? 1),
    numTeams: String(opts.numTeams ?? 12),
    ppr: String(opts.ppr ?? 0.5),
  });
  const res = await fetch(
    `https://api.fantasycalc.com/values/current?${params}`
  );
  if (!res.ok) throw new Error(`FantasyCalc API error: ${res.status}`);
  return res.json();
}

// ============================================================
// Sleeper API helpers
// ============================================================

async function fetchSleeperDraft(
  draftId: string
): Promise<{
  draft_id: string;
  slot_to_roster_id?: Record<string, number>;
  type: string;
  status: string;
}> {
  const res = await fetch(`https://api.sleeper.app/v1/draft/${draftId}`);
  if (!res.ok) throw new Error(`Sleeper API error: ${res.status}`);
  return res.json();
}

// ============================================================
// Pick resolution (mirrors src/services/tradeGrading.ts)
// ============================================================

interface PickResolution {
  value: number;
  resolved: "player" | "round-avg" | "missing";
  playerId?: string;
}

function resolvePickValue(
  pick: { season: string; round: number; roster_id: number },
  drafts: Map<
    string,
    {
      slotToRosterId: Record<string, number> | null;
      draftId: string;
      status: string;
      type: string;
      totalRosters: number;
    }
  >,
  draftPicks: Map<string, Map<number, string>>,
  playerSnapshot: Map<string, number>,
  roundAverages: Map<number, number>
): PickResolution {
  const draftInfo = drafts.get(pick.season);

  if (draftInfo?.status === "complete" && draftInfo.slotToRosterId) {
    const slotMap = draftInfo.slotToRosterId;
    const teams = draftInfo.totalRosters;
    const isSnake = draftInfo.type === "snake";

    let originalSlot: number | null = null;
    for (const [slot, rosterId] of Object.entries(slotMap)) {
      if (rosterId === pick.roster_id) {
        originalSlot = parseInt(slot, 10);
        break;
      }
    }

    if (originalSlot !== null) {
      let pickNo: number;
      if (isSnake && pick.round % 2 === 0) {
        pickNo = (pick.round - 1) * teams + (teams + 1 - originalSlot);
      } else {
        pickNo = (pick.round - 1) * teams + originalSlot;
      }

      const picksForDraft = draftPicks.get(draftInfo.draftId);
      const playerId = picksForDraft?.get(pickNo);

      if (playerId) {
        const value = playerSnapshot.get(playerId);
        if (value !== undefined) {
          return { value, resolved: "player", playerId };
        }
      }
    }
  }

  const avgValue = roundAverages.get(pick.round);
  if (avgValue !== undefined) {
    return { value: avgValue, resolved: "round-avg" };
  }

  return { value: 0, resolved: "missing" };
}

// ============================================================
// Config variants to test
// ============================================================

interface GradeConfig {
  name: string;
  blendCap: number;
  blendHalflife: number;
  startRateBonusMagnitude: number;
  valueScalingFactor: number;
  productionScalingFactor: number;
  thresholds: Record<string, number>;
}

const CONFIGS: GradeConfig[] = [
  {
    name: "vsf-5k",
    blendCap: 0.9,
    blendHalflife: 0.8,
    startRateBonusMagnitude: 0.1,
    valueScalingFactor: 5000,
    productionScalingFactor: 8,
    thresholds: {
      "A+": 65,
      A: 60,
      "B+": 55,
      B: 52,
      C: 48,
      D: 45,
      "D-": 40,
    },
  },
  {
    name: "vsf-8k",
    blendCap: 0.9,
    blendHalflife: 0.8,
    startRateBonusMagnitude: 0.1,
    valueScalingFactor: 8000,
    productionScalingFactor: 8,
    thresholds: {
      "A+": 65,
      A: 60,
      "B+": 55,
      B: 52,
      C: 48,
      D: 45,
      "D-": 40,
    },
  },
  {
    name: "vsf-12k",
    blendCap: 0.9,
    blendHalflife: 0.8,
    startRateBonusMagnitude: 0.1,
    valueScalingFactor: 12000,
    productionScalingFactor: 8,
    thresholds: {
      "A+": 65,
      A: 60,
      "B+": 55,
      B: 52,
      C: 48,
      D: 45,
      "D-": 40,
    },
  },
  {
    name: "vsf-15k",
    blendCap: 0.9,
    blendHalflife: 0.8,
    startRateBonusMagnitude: 0.1,
    valueScalingFactor: 15000,
    productionScalingFactor: 8,
    thresholds: {
      "A+": 65,
      A: 60,
      "B+": 55,
      B: 52,
      C: 48,
      D: 45,
      "D-": 40,
    },
  },
  {
    name: "vsf-20k",
    blendCap: 0.9,
    blendHalflife: 0.8,
    startRateBonusMagnitude: 0.1,
    valueScalingFactor: 20000,
    productionScalingFactor: 8,
    thresholds: {
      "A+": 65,
      A: 60,
      "B+": 55,
      B: 52,
      C: 48,
      D: 45,
      "D-": 40,
    },
  },
  {
    name: "vsf-12k-tight",
    blendCap: 0.9,
    blendHalflife: 0.8,
    startRateBonusMagnitude: 0.1,
    valueScalingFactor: 12000,
    productionScalingFactor: 8,
    thresholds: {
      "A+": 62,
      A: 58,
      "B+": 54,
      B: 52,
      C: 48,
      D: 44,
      "D-": 38,
    },
  },
  {
    name: "vsf-15k-tight",
    blendCap: 0.9,
    blendHalflife: 0.8,
    startRateBonusMagnitude: 0.1,
    valueScalingFactor: 15000,
    productionScalingFactor: 8,
    thresholds: {
      "A+": 62,
      A: 58,
      "B+": 54,
      B: 52,
      C: 48,
      D: 44,
      "D-": 38,
    },
  },
];

// ============================================================
// Helpers
// ============================================================

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function prodWeight(
  weeksElapsed: number,
  cap: number,
  halflife: number
): number {
  const years = weeksElapsed / 52;
  if (years <= 0) return 0;
  return (cap * years) / (years + halflife);
}

function scoreToGrade(
  score: number,
  thresholds: Record<string, number>
): string {
  if (score >= thresholds["A+"]) return "A+";
  if (score >= thresholds["A"]) return "A";
  if (score >= thresholds["B+"]) return "B+";
  if (score >= thresholds["B"]) return "B";
  if (score >= thresholds["C"]) return "C";
  if (score >= thresholds["D"]) return "D";
  if (score >= thresholds["D-"]) return "D-";
  return "F";
}

function stats(values: number[]) {
  if (values.length === 0)
    return { min: 0, max: 0, mean: 0, median: 0, stddev: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    stddev: Math.round(Math.sqrt(variance) * 100) / 100,
  };
}

function histogram(
  values: number[],
  bins = 10
): { min: number; max: number; counts: number[] } {
  if (values.length === 0) return { min: 0, max: 0, counts: [] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const binWidth = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / binWidth), bins - 1);
    counts[idx]++;
  }
  return { min, max, counts };
}

// ============================================================
// Main
// ============================================================

async function run() {
  // ── Step 0: Derive league settings ──
  const TEST_LEAGUE_ID_FOR_SETTINGS = "1326428203060830208";
  const [leagueSettings] = await db
    .select({
      scoringSettings: schema.leagues.scoringSettings,
      rosterPositions: schema.leagues.rosterPositions,
      totalRosters: schema.leagues.totalRosters,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, TEST_LEAGUE_ID_FOR_SETTINGS))
    .limit(1);

  const rosterPositions = (leagueSettings?.rosterPositions as string[]) || [];
  const hasSuperFlex = rosterPositions.includes("SUPER_FLEX");
  const numQbs = hasSuperFlex ? 2 : 1;
  const scoring = leagueSettings?.scoringSettings as Record<string, number> | null;
  const ppr = scoring?.rec ?? 0.5;
  const numTeams = leagueSettings?.totalRosters || 12;
  console.log(`League settings: numQbs=${numQbs} (superflex=${hasSuperFlex}), ppr=${ppr}, teams=${numTeams}`);

  // ── Step 1: Fetch and store FantasyCalc values ──
  console.log("=== Step 1: Fetching FantasyCalc values ===");
  const fcValues = await fetchFantasyCalcValues({ numQbs, numTeams, ppr });
  const withSleeperId = fcValues.filter((v) => v.player.sleeperId);
  const pickEntries = fcValues.filter((v) => v.player.position === "PICK");
  console.log(
    `  Fetched ${fcValues.length} total entries (${withSleeperId.length} with sleeperId, ${pickEntries.length} PICK entries)`
  );

  // Insert into DB
  const fetchedAt = new Date();
  const BATCH_SIZE = 50;
  for (let i = 0; i < withSleeperId.length; i += BATCH_SIZE) {
    const batch = withSleeperId.slice(i, i + BATCH_SIZE);
    await db.insert(schema.fantasyCalcValues).values(
      batch.map((v) => ({
        playerId: v.player.sleeperId!,
        playerName: v.player.name,
        value: v.value,
        rank: v.overallRank,
        positionRank: v.positionRank,
        position: v.player.position,
        team: v.player.maybeTeam,
        fetchedAt,
      }))
    );
  }

  // Also insert PICK entries (use name as ID since no sleeperId)
  for (let i = 0; i < pickEntries.length; i += BATCH_SIZE) {
    const batch = pickEntries.slice(i, i + BATCH_SIZE);
    await db.insert(schema.fantasyCalcValues).values(
      batch.map((v) => ({
        playerId: `PICK_${v.player.name.replace(/\s+/g, "_")}`,
        playerName: v.player.name,
        value: v.value,
        rank: v.overallRank,
        positionRank: v.positionRank,
        position: "PICK",
        team: null,
        fetchedAt,
      }))
    );
  }

  console.log(
    `  Inserted ${withSleeperId.length + pickEntries.length} values into DB`
  );

  // Build player snapshot
  const playerSnapshot = new Map<string, number>();
  for (const v of withSleeperId) {
    playerSnapshot.set(v.player.sleeperId!, v.value);
  }

  // Build round averages from PICK entries
  const roundGroups = new Map<number, number[]>();
  for (const v of pickEntries) {
    const name = v.player.name;
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
      roundGroups.get(round)!.push(v.value);
    }
  }
  const roundAverages = new Map<number, number>();
  for (const [round, values] of roundGroups) {
    roundAverages.set(
      round,
      values.reduce((a, b) => a + b, 0) / values.length
    );
  }
  console.log(
    `  Round averages: ${[...roundAverages.entries()]
      .map(([r, v]) => `R${r}=${Math.round(v)}`)
      .join(", ")}`
  );

  // ── Step 2: Find league family and fetch slot_to_roster_id ──
  console.log("\n=== Step 2: Finding league family & fetching draft data ===");
  const TEST_LEAGUE_ID = "1326428203060830208";

  const families = await db.select().from(schema.leagueFamilies);
  let familyId: string | null = null;
  for (const f of families) {
    const members = await db
      .select()
      .from(schema.leagueFamilyMembers)
      .where(eq(schema.leagueFamilyMembers.familyId, f.id));
    if (members.some((m) => m.leagueId === TEST_LEAGUE_ID)) {
      familyId = f.id;
      break;
    }
  }

  if (!familyId) {
    console.error(
      `Could not find league family containing ${TEST_LEAGUE_ID}`
    );
    process.exit(1);
  }
  console.log(`  Found family: ${familyId}`);

  const familyMembers = await db
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, familyId));

  const familyLeagueIds = familyMembers.map((m) => m.leagueId);
  console.log(`  Family has ${familyLeagueIds.length} seasons`);

  // Get totalRosters per league
  const leagueRows = await db
    .select({
      id: schema.leagues.id,
      totalRosters: schema.leagues.totalRosters,
    })
    .from(schema.leagues)
    .where(inArray(schema.leagues.id, familyLeagueIds));
  const rosterCountMap = new Map(
    leagueRows.map((l) => [l.id, l.totalRosters || 12])
  );

  // Fetch slot_to_roster_id for all drafts
  const allDrafts = await db
    .select()
    .from(schema.drafts)
    .where(inArray(schema.drafts.leagueId, familyLeagueIds));

  console.log(`  Found ${allDrafts.length} drafts`);

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

  for (const draft of allDrafts) {
    let slotToRosterId = draft.slotToRosterId as Record<
      string,
      number
    > | null;

    // If we don't have slot_to_roster_id, fetch from Sleeper API
    if (!slotToRosterId && draft.status === "complete") {
      try {
        const sleeperDraft = await fetchSleeperDraft(draft.id);
        slotToRosterId = sleeperDraft.slot_to_roster_id || null;
        if (slotToRosterId) {
          // Store it in DB for future use
          await db
            .update(schema.drafts)
            .set({ slotToRosterId })
            .where(eq(schema.drafts.id, draft.id));
          console.log(
            `  Fetched & stored slot_to_roster_id for draft ${draft.id} (${draft.season})`
          );
        }
      } catch (e) {
        console.warn(
          `  Failed to fetch slot_to_roster_id for draft ${draft.id}:`,
          e
        );
      }
    }

    draftsBySeason.set(draft.season, {
      slotToRosterId,
      draftId: draft.id,
      status: draft.status || "",
      type: draft.type || "snake",
      totalRosters: rosterCountMap.get(draft.leagueId) || 12,
    });
  }

  // Load draft picks for completed drafts
  const completedDraftIds = allDrafts
    .filter((d) => d.status === "complete")
    .map((d) => d.id);

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
    if (!draftPicksMap.has(dp.draftId)) {
      draftPicksMap.set(dp.draftId, new Map());
    }
    draftPicksMap.get(dp.draftId)!.set(dp.pickNo, dp.playerId);
  }

  console.log(
    `  Loaded ${allDraftPicks.length} draft picks from ${completedDraftIds.length} completed drafts`
  );

  // ── Step 3: Get trades and run calibration ──
  console.log("\n=== Step 3: Running calibration ===");

  const trades = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        inArray(schema.transactions.leagueId, familyLeagueIds),
        eq(schema.transactions.type, "trade")
      )
    );

  console.log(`  Found ${trades.length} trades across family\n`);

  if (trades.length === 0) {
    console.log("No trades to calibrate against.");
    process.exit(0);
  }

  // Get player names for diagnostics
  const allPlayerIds = new Set<string>();
  for (const trade of trades) {
    const adds = (trade.adds || {}) as Record<string, number>;
    const drops = (trade.drops || {}) as Record<string, number>;
    for (const pid of Object.keys(adds)) allPlayerIds.add(pid);
    for (const pid of Object.keys(drops)) allPlayerIds.add(pid);
  }

  const playerNames = new Map<string, string>();
  if (allPlayerIds.size > 0) {
    const playerRows = await db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players)
      .where(inArray(schema.players.id, [...allPlayerIds]));
    for (const p of playerRows) {
      playerNames.set(p.id, p.name);
    }
  }

  // Run each config
  const results: Array<{
    config: GradeConfig;
    scores: number[];
    grades: Record<string, number>;
    tradeDetails: Array<{
      txId: string;
      sides: Array<{
        rosterId: number;
        received: string[];
        sent: string[];
        valueReceived: number;
        valueSent: number;
        score: number;
        grade: string;
        pickResolutions: string[];
      }>;
    }>;
  }> = [];

  for (const config of CONFIGS) {
    console.log(`\n--- Config: ${config.name} ---`);

    const allScores: number[] = [];
    const gradeCounts: Record<string, number> = {};
    const tradeDetails: (typeof results)[0]["tradeDetails"] = [];

    for (const trade of trades) {
      const adds = (trade.adds || {}) as Record<string, number>;
      const drops = (trade.drops || {}) as Record<string, number>;
      const draftPicks = (trade.draftPicks || []) as Array<{
        season: string;
        round: number;
        roster_id: number;
        previous_owner_id: number;
        owner_id: number;
      }>;
      const rosterIds = (trade.rosterIds || []) as number[];

      if (rosterIds.length === 0) continue;

      const tradeTimestamp = trade.createdAt || Date.now();
      const weeksElapsed = Math.floor(
        (Date.now() - tradeTimestamp) / (7 * 24 * 60 * 60 * 1000)
      );

      const tradeSides: (typeof tradeDetails)[0]["sides"] = [];

      for (const rosterId of rosterIds) {
        let valueReceived = 0;
        const received: string[] = [];
        const sent: string[] = [];
        const pickResolutions: string[] = [];

        // Players received
        for (const [playerId, addedTo] of Object.entries(adds)) {
          if (addedTo === rosterId) {
            const val = playerSnapshot.get(playerId) || 0;
            valueReceived += val;
            received.push(
              `${playerNames.get(playerId) || playerId} (${val})`
            );
          }
        }

        // Picks received
        for (const dp of draftPicks) {
          if (dp.owner_id === rosterId) {
            const res = resolvePickValue(
              { season: dp.season, round: dp.round, roster_id: dp.roster_id },
              draftsBySeason,
              draftPicksMap,
              playerSnapshot,
              roundAverages
            );
            valueReceived += res.value;
            const pickLabel = `${dp.season} R${dp.round} (${res.resolved}${res.playerId ? `: ${playerNames.get(res.playerId) || res.playerId}` : ""} = ${res.value})`;
            received.push(pickLabel);
            pickResolutions.push(
              `recv ${dp.season} R${dp.round}: ${res.resolved}${res.playerId ? ` → ${playerNames.get(res.playerId) || res.playerId}` : ""} = ${res.value}`
            );
          }
        }

        let valueSent = 0;
        // Players sent
        for (const [playerId, droppedFrom] of Object.entries(drops)) {
          if (droppedFrom === rosterId) {
            const val = playerSnapshot.get(playerId) || 0;
            valueSent += val;
            sent.push(
              `${playerNames.get(playerId) || playerId} (${val})`
            );
          }
        }

        // Picks sent
        for (const dp of draftPicks) {
          if (dp.previous_owner_id === rosterId) {
            const res = resolvePickValue(
              { season: dp.season, round: dp.round, roster_id: dp.roster_id },
              draftsBySeason,
              draftPicksMap,
              playerSnapshot,
              roundAverages
            );
            valueSent += res.value;
            const pickLabel = `${dp.season} R${dp.round} (${res.resolved}${res.playerId ? `: ${playerNames.get(res.playerId) || res.playerId}` : ""} = ${res.value})`;
            sent.push(pickLabel);
            pickResolutions.push(
              `sent ${dp.season} R${dp.round}: ${res.resolved}${res.playerId ? ` → ${playerNames.get(res.playerId) || res.playerId}` : ""} = ${res.value}`
            );
          }
        }

        const diff = valueReceived - valueSent;
        const valueScore =
          50 + clamp(diff / config.valueScalingFactor, -1, 1) * 50;
        const blendedScore = valueScore; // Value-only for calibration
        const grade = scoreToGrade(blendedScore, config.thresholds);

        allScores.push(blendedScore);
        gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;

        tradeSides.push({
          rosterId,
          received,
          sent,
          valueReceived,
          valueSent,
          score: Math.round(blendedScore * 10) / 10,
          grade,
          pickResolutions,
        });
      }

      tradeDetails.push({ txId: trade.id, sides: tradeSides });
    }

    const s = stats(allScores);
    console.log(
      `  Scores: n=${allScores.length}, min=${s.min}, max=${s.max}, mean=${s.mean}, median=${s.median}, stddev=${s.stddev}`
    );
    console.log(
      `  Grades: ${JSON.stringify(gradeCounts)}`
    );

    results.push({
      config,
      scores: allScores,
      grades: gradeCounts,
      tradeDetails,
    });
  }

  // ── Step 4: Write calibration report ──
  console.log("\n=== Step 4: Writing calibration report ===");

  const docsDir = path.join(process.cwd(), "docs");
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

  let md = "# Trade Grade Calibration Report\n\n";
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `## Data\n`;
  md += `- League family: ${familyId}\n`;
  md += `- Leagues: ${familyLeagueIds.length} seasons\n`;
  md += `- Trades: ${trades.length}\n`;
  md += `- FantasyCalc player values: ${playerSnapshot.size}\n`;
  md += `- FantasyCalc pick entries: ${pickEntries.length}\n`;
  md += `- Round averages: ${[...roundAverages.entries()]
    .map(([r, v]) => `R${r}=${Math.round(v)}`)
    .join(", ")}\n`;
  md += `- Completed drafts with slot mapping: ${[...draftsBySeason.values()].filter((d) => d.status === "complete" && d.slotToRosterId).length}\n\n`;

  // Per-config results
  for (const r of results) {
    const s = stats(r.scores);
    const h = histogram(r.scores, 10);
    md += `## Config: ${r.config.name}\n\n`;
    md += `| Param | Value |\n|-------|-------|\n`;
    md += `| blendCap | ${r.config.blendCap} |\n`;
    md += `| blendHalflife | ${r.config.blendHalflife} |\n`;
    md += `| valueScalingFactor | ${r.config.valueScalingFactor} |\n`;
    md += `| productionScalingFactor | ${r.config.productionScalingFactor} |\n`;
    md += `| startRateBonusMagnitude | ${r.config.startRateBonusMagnitude} |\n\n`;
    md += `**Score distribution:** n=${r.scores.length}, mean=${s.mean}, median=${s.median}, stddev=${s.stddev}, min=${s.min}, max=${s.max}\n\n`;
    md += `**Histogram:** [${h.counts.join(", ")}]\n\n`;
    md += `**Grade distribution:**\n\n`;
    md += `| Grade | Count |\n|-------|-------|\n`;
    for (const g of ["A+", "A", "B+", "B", "C", "D", "D-", "F"]) {
      md += `| ${g} | ${r.grades[g] || 0} |\n`;
    }
    md += `\n**Thresholds:** ${JSON.stringify(r.config.thresholds)}\n\n`;
    md += `---\n\n`;
  }

  // Detailed trade diagnostics (using first/best config)
  const bestResult = results[0]; // will be replaced by actual best below
  md += `## Trade Diagnostics (${bestResult.config.name})\n\n`;
  for (const trade of bestResult.tradeDetails.slice(0, 20)) {
    md += `### Trade ${trade.txId.slice(0, 16)}...\n\n`;
    for (const side of trade.sides) {
      md += `**Roster ${side.rosterId}** — Score: ${side.score} (${side.grade})\n`;
      md += `- Received: ${side.received.join(", ") || "nothing"}\n`;
      md += `- Sent: ${side.sent.join(", ") || "nothing"}\n`;
      if (side.pickResolutions.length > 0) {
        md += `- Pick resolutions: ${side.pickResolutions.join("; ")}\n`;
      }
      md += `- Value received: ${side.valueReceived}, sent: ${side.valueSent}\n\n`;
    }
  }

  // Pick best config: prefer distributions where most grades are in the middle
  // (minimize bimodality — penalize configs where A+ + F dominate)
  const scored = results.map((r) => {
    const s = stats(r.scores);
    const n = r.scores.length || 1;
    const extremePct = ((r.grades["A+"] || 0) + (r.grades["F"] || 0)) / n;
    const middlePct =
      ((r.grades["B+"] || 0) +
        (r.grades["B"] || 0) +
        (r.grades["C"] || 0) +
        (r.grades["D"] || 0)) /
      n;
    const meanPenalty = Math.abs(s.mean - 50);
    // Higher is better: reward middle grades, penalize extremes and off-center mean
    const bellScore = middlePct - extremePct * 0.5 - meanPenalty * 0.01;
    return { ...r, spreadScore: bellScore, stats: s };
  });
  scored.sort((a, b) => b.spreadScore - a.spreadScore);
  const best = scored[0];

  md += `## Recommended Config: **${best.config.name}**\n\n`;
  md += "```typescript\n";
  md += `export const GRADE_CONFIG = {\n`;
  md += `  blendCap: ${best.config.blendCap},\n`;
  md += `  blendHalflife: ${best.config.blendHalflife},\n`;
  md += `  startRateBonusMagnitude: ${best.config.startRateBonusMagnitude},\n`;
  md += `  valueScalingFactor: ${best.config.valueScalingFactor},\n`;
  md += `  productionScalingFactor: ${best.config.productionScalingFactor},\n`;
  md += `  thresholds: ${JSON.stringify(best.config.thresholds)},\n`;
  md += `};\n`;
  md += "```\n\n";
  md += `Rationale: Best combination of score spread (stddev=${best.stats.stddev}) and centered mean (${best.stats.mean}).\n`;

  fs.writeFileSync(path.join(docsDir, "trade-grade-calibration.md"), md);
  console.log(`\nCalibration report written to docs/trade-grade-calibration.md`);
  console.log(`Recommended config: ${best.config.name}`);
  console.log(
    `  valueScalingFactor: ${best.config.valueScalingFactor}, thresholds: ${JSON.stringify(best.config.thresholds)}`
  );
}

run().catch(console.error);
