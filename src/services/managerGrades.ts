import { getDb, schema } from "@/db";
import { eq, and, inArray, like } from "drizzle-orm";

// ============================================================
// Time-decay weighting
// ============================================================

/** Half-life in years — a season 5 years ago counts ~50% of the current one. */
const DECAY_HALFLIFE_YEARS = 5;

/**
 * Exponential decay weight for a season relative to the current year.
 * weight = 0.5 ^ (yearsAgo / halflife)
 */
function seasonWeight(season: number, currentYear: number): number {
  const yearsAgo = currentYear - season;
  if (yearsAgo <= 0) return 1;
  return Math.pow(0.5, yearsAgo / DECAY_HALFLIFE_YEARS);
}

// ============================================================
// Grade thresholds (shared across all metric types)
// ============================================================

const GRADE_THRESHOLDS: Record<string, number> = {
  "A+": 95,
  A: 90,
  "B+": 85,
  B: 80,
  C: 70,
  D: 60,
  "D-": 50,
};

function scoreToGrade(score: number): string {
  if (score >= GRADE_THRESHOLDS["A+"]) return "A+";
  if (score >= GRADE_THRESHOLDS["A"]) return "A";
  if (score >= GRADE_THRESHOLDS["B+"]) return "B+";
  if (score >= GRADE_THRESHOLDS["B"]) return "B";
  if (score >= GRADE_THRESHOLDS["C"]) return "C";
  if (score >= GRADE_THRESHOLDS["D"]) return "D";
  if (score >= GRADE_THRESHOLDS["D-"]) return "D-";
  return "F";
}

/**
 * Compute percentile for a score within a sorted (ascending) array of scores.
 * Returns 50 for single-element arrays.
 */
function computePercentile(entry: { score: number }, sortedAsc: { score: number }[]): number {
  if (sortedAsc.length <= 1) return 50;
  const rank = sortedAsc.filter((s) => s.score < entry.score).length;
  return Math.round((rank / (sortedAsc.length - 1)) * 1000) / 10;
}

// ============================================================
// Rollup: all_time per-metric + overall_score
// ============================================================

/**
 * Aggregate all season-scoped manager metrics in a league family into
 * `all_time` scores with exponential time-decay weighting, then compute
 * an `overall_score` blending all available metric types.
 *
 * Call this after all per-metric grading (lineup, trade, draft, etc.)
 * has written its season-scoped rows.
 */
export async function rollupManagerGrades(familyId: string): Promise<void> {
  const db = getDb();

  // 1. Get all leagues in the family with their seasons
  const members = await db
    .select({
      leagueId: schema.leagueFamilyMembers.leagueId,
      season: schema.leagueFamilyMembers.season,
    })
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, familyId));

  if (members.length === 0) return;

  const leagueIds = members.map((m) => m.leagueId);
  const leagueSeasonMap = new Map(
    members.map((m) => [m.leagueId, parseInt(m.season, 10)]),
  );
  const currentYear = Math.max(
    ...members.map((m) => parseInt(m.season, 10)).filter((s) => !isNaN(s)),
  );

  // 2. Load all season-scoped metrics for these leagues
  const allMetrics = await db
    .select()
    .from(schema.managerMetrics)
    .where(
      and(
        inArray(schema.managerMetrics.leagueId, leagueIds),
        like(schema.managerMetrics.scope, "season:%"),
      ),
    );

  if (allMetrics.length === 0) return;

  // 3. Group by (managerId, metric) → array of { value, season, leagueId }
  const grouped = new Map<
    string,
    Array<{ value: number; season: number; leagueId: string; meta: unknown }>
  >();

  for (const row of allMetrics) {
    const season =
      leagueSeasonMap.get(row.leagueId) ??
      parseInt(row.scope.replace("season:", ""), 10);
    if (isNaN(season)) {
      console.warn(
        `[managerGrades] Could not parse season from scope "${row.scope}" for league ${row.leagueId}`,
      );
      continue;
    }

    const key = `${row.managerId}::${row.metric}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({
      value: row.value,
      season,
      leagueId: row.leagueId,
      meta: row.meta,
    });
  }

  // 4. Compute weighted all_time score per (manager, metric)
  //    Also track per-manager all_time scores for overall_score computation
  const managerAllTime = new Map<
    string,
    Map<string, { score: number; seasons: number }>
  >(); // managerId → metric → { score, seasons }

  // We need all managers' all_time scores to compute percentiles at the end
  const metricScores = new Map<string, Array<{ managerId: string; score: number }>>();

  for (const [key, entries] of grouped) {
    const [managerId, metric] = key.split("::");
    // Use the league from the most recent season for the all_time row
    const sorted = [...entries].sort((a, b) => b.season - a.season);
    const primaryLeagueId = sorted[0].leagueId;

    let weightedSum = 0;
    let totalWeight = 0;

    for (const entry of entries) {
      const w = seasonWeight(entry.season, currentYear);
      weightedSum += entry.value * w;
      totalWeight += w;
    }

    const allTimeScore =
      totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 0;

    // Track for percentile + overall_score
    if (!managerAllTime.has(managerId)) managerAllTime.set(managerId, new Map());
    managerAllTime.get(managerId)!.set(metric, {
      score: allTimeScore,
      seasons: entries.length,
    });

    if (!metricScores.has(metric)) metricScores.set(metric, []);
    metricScores.get(metric)!.push({ managerId, score: allTimeScore });

    // Build season breakdown for meta
    const seasonBreakdown = sorted.map((e) => ({
      season: e.season,
      score: e.value,
      weight: Math.round(seasonWeight(e.season, currentYear) * 100) / 100,
    }));

    // Upsert all_time metric
    await db
      .insert(schema.managerMetrics)
      .values({
        leagueId: primaryLeagueId,
        managerId,
        metric,
        scope: "all_time",
        value: allTimeScore,
        percentile: 0, // computed below
        meta: {
          grade: scoreToGrade(allTimeScore),
          seasons: entries.length,
          decayHalflife: DECAY_HALFLIFE_YEARS,
          seasonBreakdown,
        },
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
          value: allTimeScore,
          meta: {
            grade: scoreToGrade(allTimeScore),
            seasons: entries.length,
            decayHalflife: DECAY_HALFLIFE_YEARS,
            seasonBreakdown,
          },
          computedAt: new Date(),
        },
      });
  }

  // 5. Compute percentiles per metric and update
  for (const [metric, scores] of metricScores) {
    const sorted = [...scores].sort((a, b) => a.score - b.score);
    for (const entry of sorted) {
      const percentile = computePercentile(entry, sorted);

      // Find the leagueId for this manager's all_time row
      const managerMetrics = managerAllTime.get(entry.managerId);
      if (!managerMetrics) continue;

      // Update percentile on the row we just wrote
      // We need the leagueId — find from grouped entries
      const groupKey = `${entry.managerId}::${metric}`;
      const entries = grouped.get(groupKey);
      if (!entries) continue;
      const primaryLeagueId = [...entries].sort(
        (a, b) => b.season - a.season,
      )[0].leagueId;

      await db
        .update(schema.managerMetrics)
        .set({ percentile })
        .where(
          and(
            eq(schema.managerMetrics.leagueId, primaryLeagueId),
            eq(schema.managerMetrics.managerId, entry.managerId),
            eq(schema.managerMetrics.metric, metric),
            eq(schema.managerMetrics.scope, "all_time"),
          ),
        );
    }
  }

  // 6. Compute overall_score per manager (equal-weight blend of all available all_time metrics)
  const overallScores: Array<{ managerId: string; score: number }> = [];

  // Pre-build managerId → most recent leagueId from their metric entries
  const managerRecentLeague = new Map<string, string>();
  for (const [key, entries] of grouped) {
    const managerId = key.split("::")[0];
    const best = [...entries].sort((a, b) => b.season - a.season)[0];
    const existing = managerRecentLeague.get(managerId);
    if (!existing || best.season > (leagueSeasonMap.get(existing) ?? 0)) {
      managerRecentLeague.set(managerId, best.leagueId);
    }
  }

  for (const [managerId, metrics] of managerAllTime) {
    const values = Array.from(metrics.values());
    if (values.length === 0) continue;

    const overallScore =
      Math.round(
        (values.reduce((sum, v) => sum + v.score, 0) / values.length) * 10,
      ) / 10;

    // Fallback to the most recent season's league (deterministic)
    const mostRecentLeagueId = [...members].sort(
      (a, b) => parseInt(b.season, 10) - parseInt(a.season, 10),
    )[0].leagueId;
    const recentLeagueId = managerRecentLeague.get(managerId) ?? mostRecentLeagueId;

    const metricBreakdown = Object.fromEntries(
      Array.from(metrics.entries()).map(([metric, data]) => [
        metric,
        { score: data.score, seasons: data.seasons },
      ]),
    );

    overallScores.push({ managerId, score: overallScore });

    await db
      .insert(schema.managerMetrics)
      .values({
        leagueId: recentLeagueId,
        managerId,
        metric: "overall_score",
        scope: "all_time",
        value: overallScore,
        percentile: 0,
        meta: {
          grade: scoreToGrade(overallScore),
          metricBreakdown,
          decayHalflife: DECAY_HALFLIFE_YEARS,
        },
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
          value: overallScore,
          meta: {
            grade: scoreToGrade(overallScore),
            metricBreakdown,
            decayHalflife: DECAY_HALFLIFE_YEARS,
          },
          computedAt: new Date(),
        },
      });
  }

  // 7. Update overall_score percentiles
  const sortedOverall = [...overallScores].sort((a, b) => a.score - b.score);
  for (const entry of sortedOverall) {
    const percentile = computePercentile(entry, sortedOverall);

    await db
      .update(schema.managerMetrics)
      .set({ percentile })
      .where(
        and(
          eq(schema.managerMetrics.managerId, entry.managerId),
          eq(schema.managerMetrics.metric, "overall_score"),
          eq(schema.managerMetrics.scope, "all_time"),
        ),
      );
  }

  console.log(
    `[managerGrades] Rolled up grades for ${managerAllTime.size} managers across ${members.length} seasons`,
  );
}
