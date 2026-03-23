/**
 * Experiment 3: Production Layer Ablation
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

import { runExperiment, db, schema, spearmanCorrelation, printTable } from "./helpers";
import { computeLeagueMOS } from "../../src/services/outcomeScore";
import { eq, inArray } from "drizzle-orm";
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
  BELOW_REPLACEMENT_FLOOR,
} from "../../src/services/gradingCore";

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

runExperiment({
  name: "production-layer-ablation",
  hypothesis:
    "Adding starter/matchup/playoff layers produces grades that better correlate with season outcomes",
  run: async (ctx) => {
    const families = await ctx.db.select().from(schema.leagueFamilies);
    if (families.length === 0) {
      ctx.log("No league families found.");
      return { metrics: {}, rawData: [] };
    }

    const allMetrics: Record<string, Record<string, { corrWinPct: number; corrFpts: number; corrMOS: number | null }>> = {};
    const allRawRows: Record<string, unknown>[] = [];

    for (const family of families) {
      ctx.log(`\n--- Family: ${family.name} ---`);

      const members = await ctx.db
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
      const rosterRows = await ctx.db
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

        const playoffCfg = playoffConfig.get(leagueId);
        const playoffStart = playoffCfg?.playoffStart ?? null;

        ctx.log(`\n  Season ${season} (${leagueRosters.length} rosters):`);

        // Compute MOS for this league
        const leagueMOS = await computeLeagueMOS(leagueId, undefined, db);
        const mosMap = new Map(leagueMOS.map((m) => [m.rosterId, m.mos]));

        const tableRows: (string | number)[][] = [];
        const seasonKey = `${family.name}:${season}`;
        allMetrics[seasonKey] = {};

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

              const posSeasonKey = `${season}:${position}`;
              const repPPG = seasonalData.replacementPPG.get(posSeasonKey) ?? 0;
              const maxPAR = seasonalData.maxPAR.get(posSeasonKey) ?? 1;

              const playerScores = leagueScores.get(playerId) ?? [];
              const rosterScores = playerScores.filter(
                (ws) => ws.rosterId === roster.rosterId,
              );

              for (const ws of rosterScores) {
                const rawPAR = pointsAboveReplacement(ws.points, repPPG);
                const isOptimal = rawPAR > 0;

                let mult = 1.0;

                if (config.starter) {
                  const sMult = starterMultiplier(ws.isStarter, isOptimal);
                  if (sMult === 0) continue;
                  mult *= sMult;
                } else {
                  // No starter layer — skip below-replacement weeks (no floor)
                  if (!isOptimal) continue;
                }

                const effectivePAR = isOptimal ? rawPAR : repPPG * BELOW_REPLACEMENT_FLOOR;

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
                  mult *= playoffWeightMultiplier(ws.week, playoffStart, playoffCfg?.championshipWeek ?? null);
                }

                totalProd += scaledPAR(effectivePAR, maxPAR) * mult;
              }
            }

            rosterProductions.set(roster.rosterId, totalProd);
          }

          // Build arrays for correlation
          const productions: number[] = [];
          const winPcts: number[] = [];
          const fpts: number[] = [];
          const mosVals: number[] = [];
          const hasMOS = mosMap.size > 0;

          for (const roster of leagueRosters) {
            const prod = rosterProductions.get(roster.rosterId) ?? 0;
            const totalGames = (roster.wins ?? 0) + (roster.losses ?? 0) + (roster.ties ?? 0);
            const winPct = totalGames > 0 ? (roster.wins ?? 0) / totalGames : 0;

            productions.push(prod);
            winPcts.push(winPct);
            fpts.push(roster.fpts ?? 0);
            if (hasMOS) mosVals.push(mosMap.get(roster.rosterId) ?? 0);
          }

          const corrWin = spearmanCorrelation(productions, winPcts);
          const corrFpts = spearmanCorrelation(productions, fpts);
          const corrMOS = hasMOS ? spearmanCorrelation(productions, mosVals) : null;

          const corrWinRounded = Math.round(corrWin * 1000) / 1000;
          const corrFptsRounded = Math.round(corrFpts * 1000) / 1000;
          const corrMOSRounded = hasMOS ? Math.round(corrMOS * 1000) / 1000 : null;

          allMetrics[seasonKey][config.name] = {
            corrWinPct: corrWinRounded,
            corrFpts: corrFptsRounded,
            corrMOS: corrMOSRounded,
          };

          tableRows.push([
            config.name,
            leagueRosters.length,
            corrWin.toFixed(3),
            corrFpts.toFixed(3),
            hasMOS ? corrMOS.toFixed(3) : "n/a",
          ]);
        }

        printTable(
          ["Config", "Rosters", "Corr(prod,winPct)", "Corr(prod,fpts)", "Corr(prod,MOS)"],
          tableRows,
        );

        // Store raw rows for this season
        for (const row of tableRows) {
          allRawRows.push({
            family: family.name,
            season,
            config: row[0],
            rosters: row[1],
            corrWinPct: row[2],
            corrFpts: row[3],
            corrMOS: row[4],
          });
        }
      }
    }

    ctx.log("\nHigher correlation = layers add meaningful signal.");

    return {
      metrics: allMetrics,
      rawData: allRawRows,
    };
  },
});
