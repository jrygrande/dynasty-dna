/**
 * Experiment 5: MOS Weight Sensitivity
 *
 * Hypothesis: The baseline weights (40/30/20/10) produce MOS distributions
 * with the best discrimination (entropy) and cross-season stability
 * (correlation of manager MOS across consecutive seasons).
 *
 * Method:
 *   For each weight vector, compute MOS for all rosters across all family
 *   league seasons. Measure:
 *     1. Shannon entropy of MOS distribution (higher = better discrimination)
 *     2. Spearman correlation of owner MOS between consecutive seasons
 *        (higher = more stable signal, not noise)
 *     3. Descriptive stats (min, max, mean, stddev)
 *
 * Usage: npx tsx scripts/experiments/05-mos-weights.ts
 */

import { eq } from "drizzle-orm";
import {
  runExperiment,
  db,
  schema,
  describeArray,
  spearmanCorrelation,
  shannonEntropy,
  printTable,
} from "./helpers";
import {
  computeLeagueMOS,
  type MOSWeights,
  type ManagerOutcomeScore,
} from "../../src/services/outcomeScore";

const WEIGHT_VECTORS: (MOSWeights & { name: string })[] = [
  { name: "baseline",       winPct: 0.30, starter: 0.40, playoff: 0.20, champ: 0.10 },
  { name: "wins-heavy",     winPct: 0.40, starter: 0.30, playoff: 0.20, champ: 0.10 },
  { name: "wins-dominant",  winPct: 0.50, starter: 0.25, playoff: 0.15, champ: 0.10 },
  { name: "playoff-heavy",  winPct: 0.30, starter: 0.20, playoff: 0.35, champ: 0.15 },
  { name: "equal",          winPct: 0.25, starter: 0.25, playoff: 0.25, champ: 0.25 },
];

/**
 * Discretize MOS values into bins for entropy calculation.
 * Uses 10 equal-width bins from 0 to 1.
 */
function discretizeMOS(scores: number[]): string[] {
  return scores.map((s) => {
    const bin = Math.min(Math.floor(s * 10), 9);
    return `${(bin / 10).toFixed(1)}-${((bin + 1) / 10).toFixed(1)}`;
  });
}

/**
 * Compute cross-season stability: for owners who appear in consecutive seasons,
 * correlate their MOS scores.
 */
function crossSeasonCorrelation(
  scores: ManagerOutcomeScore[],
  rosterOwners: Map<string, string>, // "leagueId:rosterId" -> ownerId
): number {
  // Group scores by season
  const bySeason = new Map<string, ManagerOutcomeScore[]>();
  for (const s of scores) {
    const arr = bySeason.get(s.season) ?? [];
    arr.push(s);
    bySeason.set(s.season, arr);
  }

  const seasons = [...bySeason.keys()].sort();
  if (seasons.length < 2) return 0;

  const prevScores: number[] = [];
  const nextScores: number[] = [];

  for (let i = 0; i < seasons.length - 1; i++) {
    const prev = bySeason.get(seasons[i]) ?? [];
    const next = bySeason.get(seasons[i + 1]) ?? [];

    // Build owner -> MOS maps for each season
    const prevOwnerMOS = new Map<string, number>();
    for (const s of prev) {
      const owner = rosterOwners.get(`${s.leagueId}:${s.rosterId}`);
      if (owner) prevOwnerMOS.set(owner, s.mos);
    }

    const nextOwnerMOS = new Map<string, number>();
    for (const s of next) {
      const owner = rosterOwners.get(`${s.leagueId}:${s.rosterId}`);
      if (owner) nextOwnerMOS.set(owner, s.mos);
    }

    // Find overlapping owners
    for (const [owner, prevMos] of prevOwnerMOS) {
      const nextMos = nextOwnerMOS.get(owner);
      if (nextMos !== undefined) {
        prevScores.push(prevMos);
        nextScores.push(nextMos);
      }
    }
  }

  if (prevScores.length < 3) return 0;
  return spearmanCorrelation(prevScores, nextScores);
}

runExperiment({
  name: "mos-weight-sensitivity",
  hypothesis:
    "The baseline weights (40/30/20/10) produce MOS distributions with the best discrimination (entropy) and cross-season stability",
  config: {
    weightVectors: WEIGHT_VECTORS.map((w) => ({
      name: w.name,
      weights: { winPct: w.winPct, starter: w.starter, playoff: w.playoff, champ: w.champ },
    })),
  },
  run: async (ctx) => {
    const families = await ctx.db.select().from(ctx.schema.leagueFamilies);
    if (families.length === 0) {
      ctx.log("No league families found.");
      return { metrics: {}, rawData: [] };
    }

    // Load all roster owners for cross-season correlation
    const allRosters = await ctx.db.select({
      leagueId: schema.rosters.leagueId,
      rosterId: schema.rosters.rosterId,
      ownerId: schema.rosters.ownerId,
    }).from(schema.rosters);

    const rosterOwners = new Map<string, string>();
    for (const r of allRosters) {
      if (r.ownerId) {
        rosterOwners.set(`${r.leagueId}:${r.rosterId}`, r.ownerId);
      }
    }

    // Collect unique league IDs across all families
    const leagueIdSet = new Set<string>();
    for (const family of families) {
      const members = await ctx.db
        .select()
        .from(ctx.schema.leagueFamilyMembers)
        .where(eq(ctx.schema.leagueFamilyMembers.familyId, family.id));

      for (const m of members) {
        leagueIdSet.add(m.leagueId);
      }
    }
    const leagueIds = [...leagueIdSet];

    const perVectorMetrics: Record<string, {
      entropy: number;
      crossSeasonCorr: number;
      stats: ReturnType<typeof describeArray>;
    }> = {};

    const tableRows: (string | number)[][] = [];

    for (const weightVector of WEIGHT_VECTORS) {
      ctx.log(`\n--- Weight vector: ${weightVector.name} ---`);
      ctx.log(`  winPct=${weightVector.winPct} starter=${weightVector.starter} playoff=${weightVector.playoff} champ=${weightVector.champ}`);

      const allScores: ManagerOutcomeScore[] = [];

      for (const lid of leagueIds) {
        const leagueMOS = await computeLeagueMOS(lid, weightVector, db);
        allScores.push(...leagueMOS);
      }

      if (allScores.length === 0) {
        ctx.log("  No scores computed.");
        continue;
      }

      const mosValues = allScores.map((s) => s.mos);
      const stats = describeArray(mosValues);
      const entropy = shannonEntropy(discretizeMOS(mosValues));
      const crossCorr = crossSeasonCorrelation(
        allScores,
        rosterOwners,
      );

      ctx.log(`  Rosters: ${allScores.length}`);
      ctx.log(`  Entropy: ${entropy.toFixed(3)}`);
      ctx.log(`  Cross-season corr: ${crossCorr.toFixed(3)}`);
      ctx.log(`  Mean: ${stats.mean.toFixed(3)}, StdDev: ${stats.stddev.toFixed(3)}`);

      perVectorMetrics[weightVector.name] = { entropy, crossSeasonCorr: crossCorr, stats };
      tableRows.push([
        weightVector.name,
        allScores.length,
        entropy.toFixed(3),
        crossCorr.toFixed(3),
        stats.mean,
        stats.stddev,
        stats.min,
        stats.max,
      ]);
    }

    if (tableRows.length > 0) {
      ctx.log("\n--- Summary ---");
      printTable(
        ["Weights", "Rosters", "Entropy", "CrossCorr", "Mean", "StdDev", "Min", "Max"],
        tableRows,
      );
    }

    return {
      metrics: perVectorMetrics,
      rawData: tableRows.map((r) => ({
        name: r[0],
        rosters: r[1],
        entropy: r[2],
        crossSeasonCorr: r[3],
        mean: r[4],
        stddev: r[5],
        min: r[6],
        max: r[7],
      })),
    };
  },
});
