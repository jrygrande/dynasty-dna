import { getDb, schema } from "@/db";
import { eq, and, inArray } from "drizzle-orm";
import { syncFantasyCalcValues } from "@/services/fantasyCalcSync";
import {
  GRADE_CONFIG,
  productionWeight,
  scoreToGrade,
  normalizeScore,
  playerProductionScore,
  computeSeasonalRanks,
  computePercentile,
  loadLeagueScoringConfig,
  loadFamilyLeagueMap,
  loadFantasyCalcSnapshot,
} from "@/services/gradingCore";

// ============================================================
// Draft Grading Configuration
// ============================================================

const DRAFT_GRADE_CONFIG = {
  benchmarkWindow: 8,  // look at next 8 picks
  benchmarkTake: 6,    // best 6 of those
  minBenchmark: 4,     // skip grading if fewer available
};

// ============================================================
// Grade a league family's drafts
// ============================================================

export async function gradeLeagueDrafts(
  leagueId: string,
  familyId: string,
  opts?: { syncedAt?: Date },
): Promise<number> {
  const db = getDb();

  const syncedAt = opts?.syncedAt ?? await syncFantasyCalcValues(leagueId, { force: true });
  if (!syncedAt) {
    console.warn("[draftGrading] Failed to sync FantasyCalc values");
    return 0;
  }

  const { ppr, isSuperFlex } = await loadLeagueScoringConfig(leagueId);
  const { familyLeagueIds, leagueSeasonMap } = await loadFamilyLeagueMap(familyId);
  if (familyLeagueIds.length === 0) return 0;

  const snapshot = await loadFantasyCalcSnapshot(isSuperFlex, ppr);

  // Pre-compute seasonal ranks for production scoring
  const { ranks: seasonalRanks, activeWeeks: seasonalActiveWeeks, positions: playerPositions } =
    await computeSeasonalRanks(familyLeagueIds, leagueSeasonMap);

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

  // Load rosters for rosterId → ownerId mapping
  const rosters = await db
    .select({ rosterId: schema.rosters.rosterId, ownerId: schema.rosters.ownerId })
    .from(schema.rosters)
    .where(eq(schema.rosters.leagueId, leagueId));

  const rosterToOwner = new Map<number, string>();
  for (const r of rosters) {
    if (r.ownerId) rosterToOwner.set(r.rosterId, r.ownerId);
  }

  const currentYear = new Date().getFullYear();
  let graded = 0;

  for (const draft of drafts) {
    // Per-manager aggregation: managerId → { totalScore, count } — reset per draft
    const managerAgg = new Map<string, { totalScore: number; count: number }>();
    const picks = picksByDraft.get(draft.id);
    if (!picks || picks.length === 0) continue;

    const draftSeason = parseInt(draft.season, 10);
    const draftStartTime = draft.startTime ?? Date.now();
    const weeksElapsed = Math.floor(
      (Date.now() - draftStartTime) / (7 * 24 * 60 * 60 * 1000),
    );
    const pw = productionWeight(weeksElapsed);

    for (let i = 0; i < picks.length; i++) {
      const pick = picks[i];
      if (!pick.playerId) continue;

      // Build benchmark: next WINDOW picks after this one
      const windowPicks = picks
        .slice(i + 1, i + 1 + DRAFT_GRADE_CONFIG.benchmarkWindow)
        .filter((p) => p.playerId !== null);

      if (windowPicks.length < DRAFT_GRADE_CONFIG.minBenchmark) continue;

      // Get FantasyCalc values for benchmark players
      const benchmarkValues = windowPicks
        .map((p) => ({
          playerId: p.playerId!,
          value: snapshot.get(p.playerId!) ?? 0,
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, DRAFT_GRADE_CONFIG.benchmarkTake);

      const pickedValue = snapshot.get(pick.playerId) ?? 0;
      const avgBenchmarkValue =
        benchmarkValues.reduce((sum, bv) => sum + bv.value, 0) / benchmarkValues.length;

      const valueDiff = pickedValue - avgBenchmarkValue;
      const valueScore = normalizeScore(valueDiff, GRADE_CONFIG.valueScaling);

      // Production scoring
      const pickedProduction = playerProductionScore(
        pick.playerId,
        draftSeason,
        currentYear,
        seasonalRanks,
        seasonalActiveWeeks,
        playerPositions,
      );

      const benchmarkProductions = benchmarkValues.map((bv) =>
        playerProductionScore(
          bv.playerId,
          draftSeason,
          currentYear,
          seasonalRanks,
          seasonalActiveWeeks,
          playerPositions,
        ),
      );
      const avgBenchmarkProduction =
        benchmarkProductions.reduce((sum, p) => sum + p, 0) /
        benchmarkProductions.length;

      const productionDiff = pickedProduction - avgBenchmarkProduction;
      const productionScore = normalizeScore(
        productionDiff,
        GRADE_CONFIG.productionScaling,
      );

      const blendedScore = (1 - pw) * valueScore + pw * productionScore;
      const grade = scoreToGrade(blendedScore);

      await db
        .insert(schema.draftGrades)
        .values({
          draftId: draft.id,
          pickNo: pick.pickNo,
          rosterId: pick.rosterId,
          playerId: pick.playerId,
          valueScore,
          playerValue: pickedValue,
          benchmarkValue: avgBenchmarkValue,
          productionScore: weeksElapsed > 0 ? productionScore : null,
          playerProduction: weeksElapsed > 0 ? pickedProduction : null,
          benchmarkProduction: weeksElapsed > 0 ? avgBenchmarkProduction : null,
          blendedScore,
          productionWeight: pw,
          grade,
          benchmarkSize: benchmarkValues.length,
          computedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.draftGrades.draftId, schema.draftGrades.pickNo],
          set: {
            rosterId: pick.rosterId,
            playerId: pick.playerId,
            valueScore,
            playerValue: pickedValue,
            benchmarkValue: avgBenchmarkValue,
            productionScore: weeksElapsed > 0 ? productionScore : null,
            playerProduction: weeksElapsed > 0 ? pickedProduction : null,
            benchmarkProduction: weeksElapsed > 0 ? avgBenchmarkProduction : null,
            blendedScore,
            productionWeight: pw,
            grade,
            benchmarkSize: benchmarkValues.length,
            computedAt: new Date(),
          },
        });

      graded++;

      // Track per-manager
      const ownerId = rosterToOwner.get(pick.rosterId);
      if (ownerId) {
        const agg = managerAgg.get(ownerId) ?? { totalScore: 0, count: 0 };
        agg.totalScore += blendedScore;
        agg.count++;
        managerAgg.set(ownerId, agg);
      }
    }

    // Write per-manager draft_score to managerMetrics for this season
    const season = draft.season;
    const allScores: Array<{ managerId: string; score: number }> = [];

    for (const [managerId, agg] of managerAgg) {
      if (agg.count === 0) continue;
      const avgScore = Math.round((agg.totalScore / agg.count) * 10) / 10;
      allScores.push({ managerId, score: avgScore });
    }

    // Compute percentiles
    const sortedAsc = [...allScores].sort((a, b) => a.score - b.score);

    for (const entry of allScores) {
      const percentile = computePercentile(entry, sortedAsc);
      const agg = managerAgg.get(entry.managerId)!;
      const meta = {
        grade: scoreToGrade(entry.score),
        picksGraded: agg.count,
      };

      await db
        .insert(schema.managerMetrics)
        .values({
          leagueId,
          managerId: entry.managerId,
          metric: "draft_score",
          scope: `season:${season}`,
          value: entry.score,
          percentile,
          meta,
          computedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            schema.managerMetrics.leagueId,
            schema.managerMetrics.managerId,
            schema.managerMetrics.metric,
            schema.managerMetrics.scope,
          ],
          set: {
            value: entry.score,
            percentile,
            meta,
            computedAt: new Date(),
          },
        });
    }
  }

  console.log(
    `[draftGrading] Graded ${graded} draft picks for league ${leagueId}`,
  );
  return graded;
}
