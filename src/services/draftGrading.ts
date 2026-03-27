import { getDb, schema } from "@/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { batchUpsertManagerMetrics } from "@/services/batchHelper";
import { syncFantasyCalcValues } from "@/services/fantasyCalcSync";
import {
  productionWeight,
  scoreToGrade,
  normalizeScore,
  computeQualityQuantityScores,
  playerSeasonalPAR,
  computeSeasonalRanks,
  loadLeagueScoringConfig,
  loadFamilyLeagueMap,
  loadFantasyCalcSnapshot,
} from "@/services/gradingCore";
import { getActiveConfig } from "@/services/algorithmConfig";

// ============================================================
// Draft Grading Configuration
// ============================================================

import { DEFAULT_CONFIG } from "@/services/algorithmConfig";

function adaptiveScaling(
  pickPercentile: number,
  max: number,
  min: number,
): number {
  if (process.env.NODE_ENV !== "production" && min > max) {
    throw new Error(
      `adaptiveScaling: min (${min}) must not exceed max (${max})`,
    );
  }
  return max * Math.pow(min / max, pickPercentile);
}

function latePickProductionBonus(
  pickPercentile: number,
  production: number,
  cfg: typeof DEFAULT_CONFIG.draftConfig = DEFAULT_CONFIG.draftConfig,
): number {
  const {
    bonusStartPercentile,
    bonusProductionThreshold,
    bonusMaxPoints,
    bonusExcessCap,
  } = cfg;
  if (pickPercentile < bonusStartPercentile) return 0;
  if (production <= bonusProductionThreshold) return 0;
  const lateMultiplier =
    (pickPercentile - bonusStartPercentile) /
    (1 - bonusStartPercentile);
  const excess = Math.min(
    production - bonusProductionThreshold,
    bonusExcessCap,
  );
  return lateMultiplier * (excess / bonusExcessCap) * bonusMaxPoints;
}

interface DraftGradeRow {
  draftId: string;
  pickNo: number;
  rosterId: number;
  playerId: string;
  valueScore: number;
  playerValue: number;
  benchmarkValue: number;
  productionScore: number | null;
  playerProduction: number | null;
  benchmarkProduction: number | null;
  blendedScore: number;
  productionWeight: number;
  grade: string;
  benchmarkSize: number;
  computedAt: Date;
}

// ============================================================
// Grade a league family's drafts
// ============================================================

export async function gradeLeagueDrafts(
  leagueId: string,
  familyId: string,
  opts?: { syncedAt?: Date },
): Promise<number> {
  const db = getDb();
  const algoConfig = await getActiveConfig();
  const draftCfg = algoConfig.draftConfig;

  const syncedAt =
    opts?.syncedAt ??
    (await syncFantasyCalcValues(leagueId, { force: true }));
  if (!syncedAt) {
    console.warn("[draftGrading] Failed to sync FantasyCalc values");
    return 0;
  }

  const { ppr, isSuperFlex } =
    await loadLeagueScoringConfig(leagueId);
  const { familyLeagueIds, leagueSeasonMap } =
    await loadFamilyLeagueMap(familyId);
  if (familyLeagueIds.length === 0) return 0;

  const snapshot = await loadFantasyCalcSnapshot(isSuperFlex, ppr);

  // Pre-compute seasonal data with PAR info
  const seasonalData = await computeSeasonalRanks(
    familyLeagueIds,
    leagueSeasonMap,
    { isSuperFlex },
  );

  // Load all completed drafts for this league
  const drafts = await db
    .select()
    .from(schema.drafts)
    .where(
      and(
        eq(schema.drafts.leagueId, leagueId),
        eq(schema.drafts.status, "complete"),
      ),
    );

  if (drafts.length === 0) return 0;

  const draftIds = drafts.map((d) => d.id);

  // Load all picks for these drafts
  const allPicks = await db
    .select()
    .from(schema.draftPicks)
    .where(inArray(schema.draftPicks.draftId, draftIds));

  // Group picks by draftId, sorted by pickNo
  const picksByDraft = new Map<string, typeof allPicks>();
  for (const pick of allPicks) {
    const arr = picksByDraft.get(pick.draftId) || [];
    arr.push(pick);
    picksByDraft.set(pick.draftId, arr);
  }
  for (const arr of picksByDraft.values()) {
    arr.sort((a, b) => a.pickNo - b.pickNo);
  }

  // Load rosters for rosterId -> ownerId mapping
  const rosters = await db
    .select({
      rosterId: schema.rosters.rosterId,
      ownerId: schema.rosters.ownerId,
    })
    .from(schema.rosters)
    .where(eq(schema.rosters.leagueId, leagueId));

  const rosterToOwner = new Map<number, string>();
  for (const r of rosters) {
    if (r.ownerId) rosterToOwner.set(r.rosterId, r.ownerId);
  }

  const currentYear = new Date().getFullYear();
  let graded = 0;

  for (const draft of drafts) {
    // Per-manager aggregation
    const managerAgg = new Map<
      string,
      { totalScore: number; totalRawPAR: number; count: number }
    >();
    const picks = picksByDraft.get(draft.id);
    if (!picks || picks.length === 0) continue;

    const draftSeason = parseInt(draft.season, 10);
    const draftStartTime = draft.startTime ?? Date.now();
    const weeksElapsed = Math.floor(
      (Date.now() - draftStartTime) / (7 * 24 * 60 * 60 * 1000),
    );
    const pw = productionWeight(weeksElapsed, "draft", algoConfig.blendProfiles);

    const totalPicks = picks.length;
    const gradeRows: DraftGradeRow[] = [];

    for (let i = 0; i < picks.length; i++) {
      const pick = picks[i];
      if (!pick.playerId) continue;

      try {
        const pickPercentile =
          totalPicks > 1 ? i / (totalPicks - 1) : 0;

        // Build benchmark
        const forwardPicks = picks
          .slice(
            i + 1,
            i + 1 + draftCfg.benchmarkWindow,
          )
          .filter((p) => p.playerId !== null);

        let windowPicks: typeof forwardPicks;
        if (
          forwardPicks.length >=
          draftCfg.minBenchmark
        ) {
          windowPicks = forwardPicks;
        } else {
          windowPicks = picks
            .slice(
              Math.max(
                0,
                i - draftCfg.benchmarkWindow,
              ),
              i,
            )
            .filter((p) => p.playerId !== null);
        }

        if (
          windowPicks.length < draftCfg.minBenchmark
        )
          continue;

        const benchmarkValues = windowPicks
          .map((p) => ({
            playerId: p.playerId!,
            value: snapshot.get(p.playerId!) ?? 0,
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, draftCfg.benchmarkTake);

        if (benchmarkValues.length === 0) continue;

        const pickedValue =
          snapshot.get(pick.playerId) ?? 0;
        const avgBenchmarkValue =
          benchmarkValues.reduce(
            (sum, bv) => sum + bv.value,
            0,
          ) / benchmarkValues.length;

        const {
          valueScalingMax,
          valueScalingMin,
          productionScalingMax,
          productionScalingMin,
        } = draftCfg;
        const vScaling = adaptiveScaling(
          pickPercentile,
          valueScalingMax,
          valueScalingMin,
        );
        const pScaling = adaptiveScaling(
          pickPercentile,
          productionScalingMax,
          productionScalingMin,
        );

        const valueDiff = pickedValue - avgBenchmarkValue;
        const valueScore = normalizeScore(
          valueDiff,
          vScaling,
        );

        // Production scoring — PAR-based (v2)
        const pickedProduction = playerSeasonalPAR(
          pick.playerId,
          draftSeason,
          currentYear,
          seasonalData,
        );

        const avgBenchmarkProduction =
          benchmarkValues.reduce(
            (sum, bv) =>
              sum +
              playerSeasonalPAR(
                bv.playerId,
                draftSeason,
                currentYear,
                seasonalData,
              ),
            0,
          ) / benchmarkValues.length;

        const productionDiff =
          pickedProduction - avgBenchmarkProduction;
        const productionScore = normalizeScore(
          productionDiff,
          pScaling,
        );

        const blendedScore =
          (1 - pw) * valueScore + pw * productionScore;
        const bonus = latePickProductionBonus(
          pickPercentile,
          pickedProduction,
          draftCfg,
        );
        const finalScore = Math.min(
          100,
          blendedScore + bonus,
        );
        const grade = scoreToGrade(finalScore);

        const now = new Date();
        gradeRows.push({
          draftId: draft.id,
          pickNo: pick.pickNo,
          rosterId: pick.rosterId,
          playerId: pick.playerId,
          valueScore,
          playerValue: pickedValue,
          benchmarkValue: avgBenchmarkValue,
          productionScore:
            weeksElapsed > 0 ? productionScore : null,
          playerProduction:
            weeksElapsed > 0 ? pickedProduction : null,
          benchmarkProduction:
            weeksElapsed > 0
              ? avgBenchmarkProduction
              : null,
          blendedScore: finalScore,
          productionWeight: pw,
          grade,
          benchmarkSize: benchmarkValues.length,
          computedAt: now,
        });

        // Track per-manager
        const ownerId = rosterToOwner.get(pick.rosterId);
        if (ownerId) {
          const agg = managerAgg.get(ownerId) ?? {
            totalScore: 0,
            totalRawPAR: 0,
            count: 0,
          };
          agg.totalScore += finalScore;
          agg.totalRawPAR += pickedProduction;
          agg.count++;
          managerAgg.set(ownerId, agg);
        }
      } catch (e) {
        console.warn(
          `[draftGrading] Failed to grade pick ${pick.pickNo} (player ${pick.playerId}) in draft ${draft.id}:`,
          e,
        );
      }
    }

    // Batch upsert all grade rows for this draft
    if (gradeRows.length > 0) {
      await db
        .insert(schema.draftGrades)
        .values(gradeRows)
        .onConflictDoUpdate({
          target: [
            schema.draftGrades.draftId,
            schema.draftGrades.pickNo,
          ],
          set: {
            rosterId: sql`excluded.roster_id`,
            playerId: sql`excluded.player_id`,
            valueScore: sql`excluded.value_score`,
            playerValue: sql`excluded.player_value`,
            benchmarkValue: sql`excluded.benchmark_value`,
            productionScore: sql`excluded.production_score`,
            playerProduction: sql`excluded.player_production`,
            benchmarkProduction: sql`excluded.benchmark_production`,
            blendedScore: sql`excluded.blended_score`,
            productionWeight: sql`excluded.production_weight`,
            grade: sql`excluded.grade`,
            benchmarkSize: sql`excluded.benchmark_size`,
            computedAt: sql`excluded.computed_at`,
          },
        });
      graded += gradeRows.length;
    }

    // Write per-manager draft_score to managerMetrics (quality x quantity)
    // Remap totalScore -> totalQuality for the shared aggregation helper
    const qualityAgg = new Map<
      string,
      { totalQuality: number; totalRawPAR: number; count: number }
    >();
    for (const [id, agg] of managerAgg) {
      qualityAgg.set(id, { totalQuality: agg.totalScore, totalRawPAR: agg.totalRawPAR, count: agg.count });
    }

    const metricValues = computeQualityQuantityScores(qualityAgg, {
      leagueId,
      season: draft.season,
      metric: "draft_score",
      qualityWeight: algoConfig.qualityWeights.draft_score,
      countLabel: "picksGraded",
    });

    await batchUpsertManagerMetrics(metricValues);
  }

  console.log(
    `[draftGrading] Graded ${graded} draft picks for league ${leagueId}`,
  );
  return graded;
}
