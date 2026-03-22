/**
 * Experiment 1: Production Layer Ablation
 *
 * Hypothesis: Adding starter/matchup/playoff layers produces grades that
 * better correlate with season outcomes.
 *
 * Method:
 *   For each completed season, compute trade production under 4 configs:
 *     1. Base PAR only
 *     2. PAR + starter layer
 *     3. PAR + starter + matchup layer
 *     4. PAR + starter + matchup + playoff layer (full v2)
 *   Measure Spearman rank correlation between manager trade production and:
 *     (a) win %
 *     (b) total fpts
 *
 * Usage: npx tsx scripts/experiments/03-production-layers.ts
 */

import { db, schema } from "./helpers";
import { eq, and, inArray } from "drizzle-orm";
import {
  pointsAboveReplacement,
  scaledPAR,
  starterMultiplier,
  matchupOutcomeMultiplier,
  playoffWeightMultiplier,
  computeSeasonalRanks,
  loadPlayerWeeklyScores,
  loadMatchupOutcomes,
  loadPlayoffConfig,
} from "../../src/services/gradingCore";
import { spearmanCorrelation, printTable } from "./helpers";

type LayerConfig = {
  name: string;
  starter: boolean;
  matchup: boolean;
  playoff: boolean;
};

const CONFIGS: LayerConfig[] = [
  { name: "PAR only", starter: false, matchup: false, playoff: false },
  { name: "+starter", starter: true, matchup: false, playoff: false },
  { name: "+matchup", starter: true, matchup: true, playoff: false },
  { name: "full v2", starter: true, matchup: true, playoff: true },
];

async function run() {
  console.log("=== Experiment: Production Layer Ablation ===\n");

  const families = await db.select().from(schema.leagueFamilies);
  if (families.length === 0) {
    console.log("No league families found.");
    return;
  }

  for (const family of families) {
    console.log(`\n--- Family: ${family.name} ---`);

    const members = await db
      .select()
      .from(schema.leagueFamilyMembers)
      .where(eq(schema.leagueFamilyMembers.familyId, family.id));

    const familyLeagueIds = members.map((m) => m.leagueId);
    const leagueSeasonMap = new Map(
      members.map((m) => [m.leagueId, m.season] as [string, string]),
    );

    const seasonalData = await computeSeasonalRanks(
      familyLeagueIds,
      leagueSeasonMap,
      { isSuperFlex: false },
    );

    const weeklyScores = await loadPlayerWeeklyScores(familyLeagueIds);
    const matchupOutcomes = await loadMatchupOutcomes(familyLeagueIds);
    const playoffConfig = await loadPlayoffConfig(familyLeagueIds);

    // Load roster outcomes (win %, fpts) per league
    const rosterRows = await db
      .select()
      .from(schema.rosters)
      .where(inArray(schema.rosters.leagueId, familyLeagueIds));

    // For each league/season, compute per-manager production under each config
    for (const member of members) {
      const leagueId = member.leagueId;
      const season = member.season;

      const leagueRosters = rosterRows.filter(
        (r) => r.leagueId === leagueId,
      );
      if (leagueRosters.length === 0) continue;

      const leagueScores = weeklyScores.get(leagueId);
      if (!leagueScores) continue;

      const playoffStart = playoffConfig.get(leagueId) ?? null;

      console.log(`\n  Season ${season} (${leagueRosters.length} rosters):`);

      const tableRows: (string | number)[][] = [];

      for (const config of CONFIGS) {
        // Compute total production per roster
        const rosterProductions = new Map<number, number>();

        for (const roster of leagueRosters) {
          let totalProd = 0;

          // Get all players on this roster
          const rosterPlayers = new Set<string>();
          for (const [playerId, scores] of leagueScores) {
            for (const ws of scores) {
              if (ws.rosterId === roster.rosterId) {
                rosterPlayers.add(playerId);
              }
            }
          }

          for (const playerId of rosterPlayers) {
            const position = seasonalData.positions.get(playerId);
            if (!position) continue;

            const seasonKey = `${season}:${position}`;
            const repPPG = seasonalData.replacementPPG.get(seasonKey) ?? 0;
            const maxPAR = seasonalData.maxPAR.get(seasonKey) ?? 1;

            const playerScores = leagueScores.get(playerId) ?? [];
            const rosterScores = playerScores.filter(
              (ws) => ws.rosterId === roster.rosterId,
            );

            for (const ws of rosterScores) {
              const rawPAR = pointsAboveReplacement(ws.points, repPPG);
              if (rawPAR <= 0) continue;

              let mult = 1.0;

              if (config.starter) {
                const isOptimal = ws.points > repPPG;
                mult *= starterMultiplier(ws.isStarter, isOptimal);
              }

              if (config.matchup) {
                const mKey = `${leagueId}:${ws.week}:${ws.rosterId}`;
                const outcome = matchupOutcomes.get(mKey);
                if (outcome) {
                  mult *= matchupOutcomeMultiplier(
                    ws.isStarter,
                    outcome.won,
                    outcome.margin,
                    ws.points,
                  );
                }
              }

              if (config.playoff) {
                mult *= playoffWeightMultiplier(ws.week, playoffStart);
              }

              totalProd += scaledPAR(rawPAR, maxPAR) * mult;
            }
          }

          rosterProductions.set(roster.rosterId, totalProd);
        }

        // Build arrays for correlation
        const productions: number[] = [];
        const winPcts: number[] = [];
        const fpts: number[] = [];

        for (const roster of leagueRosters) {
          const prod = rosterProductions.get(roster.rosterId) ?? 0;
          const totalGames = (roster.wins ?? 0) + (roster.losses ?? 0) + (roster.ties ?? 0);
          const winPct = totalGames > 0 ? (roster.wins ?? 0) / totalGames : 0;

          productions.push(prod);
          winPcts.push(winPct);
          fpts.push(roster.fpts ?? 0);
        }

        const corrWin = spearmanCorrelation(productions, winPcts);
        const corrFpts = spearmanCorrelation(productions, fpts);

        tableRows.push([
          config.name,
          leagueRosters.length,
          corrWin.toFixed(3),
          corrFpts.toFixed(3),
        ]);
      }

      printTable(
        ["Config", "Rosters", "Corr(prod,winPct)", "Corr(prod,fpts)"],
        tableRows,
      );
    }
  }

  console.log("\nHigher correlation = layers add meaningful signal.");
  console.log("Done.");
}

run().catch(console.error);
