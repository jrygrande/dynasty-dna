/**
 * Experiment 8: FAAB Efficiency Signal
 *
 * Hypothesis: FAAB bid efficiency adds predictive signal beyond raw value
 * scoring in FAAB leagues.
 *
 * Method:
 *   For each FAAB league-season, compute two waiver score variants:
 *   - With FAAB bonus (existing blendedScore)
 *   - Without FAAB bonus (strip bonus using stored value/production scores)
 *   Aggregate each to manager level and correlate against MOS.
 *
 * Usage: npx tsx scripts/experiments/08-faab-efficiency-signal.ts
 */

import { eq, and, isNotNull } from "drizzle-orm";
import {
  runExperiment,
  db,
  schema,
  spearmanCorrelation,
  describeArray,
  printTable,
  metric,
  noData,
  round3,
} from "./helpers";
import { computeLeagueMOS } from "../../src/services/outcomeScore";
import {
  normalizeWithinLeague,
  QUALITY_WEIGHTS,
} from "../../src/services/gradingCore";

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

runExperiment({
  name: "faab-efficiency-signal",
  hypothesis:
    "FAAB bid efficiency adds predictive signal beyond raw value scoring in FAAB leagues",
  acceptanceCriteria:
    "With-FAAB correlation > without-FAAB in >50% of FAAB league-seasons",
  run: async (ctx) => {
    // Load roster owners
    const allRosters = await ctx.db
      .select({
        leagueId: ctx.schema.rosters.leagueId,
        rosterId: ctx.schema.rosters.rosterId,
        ownerId: ctx.schema.rosters.ownerId,
      })
      .from(ctx.schema.rosters);

    const rosterToOwner = new Map<string, string>();
    for (const r of allRosters) {
      if (r.ownerId) rosterToOwner.set(`${r.leagueId}:${r.rosterId}`, r.ownerId);
    }

    // Load waiver grades that have FAAB data
    const faabGrades = await ctx.db
      .select({
        transactionId: ctx.schema.waiverGrades.transactionId,
        rosterId: ctx.schema.waiverGrades.rosterId,
        valueScore: ctx.schema.waiverGrades.valueScore,
        productionScore: ctx.schema.waiverGrades.productionScore,
        productionWeight: ctx.schema.waiverGrades.productionWeight,
        blendedScore: ctx.schema.waiverGrades.blendedScore,
        rawPAR: ctx.schema.waiverGrades.rawPAR,
        faabBid: ctx.schema.waiverGrades.faabBid,
      })
      .from(ctx.schema.waiverGrades)
      .where(isNotNull(ctx.schema.waiverGrades.faabBid));

    if (faabGrades.length === 0) return noData("No FAAB waiver grades found");

    // Get transaction -> league mapping
    const txIds = [...new Set(faabGrades.map((g) => g.transactionId))];
    const txRows = await ctx.db
      .select({ id: ctx.schema.transactions.id, leagueId: ctx.schema.transactions.leagueId })
      .from(ctx.schema.transactions);
    const txLeague = new Map(txRows.map((t) => [t.id, t.leagueId]));

    // Group by league
    const gradesByLeague = new Map<string, typeof faabGrades>();
    for (const g of faabGrades) {
      const leagueId = txLeague.get(g.transactionId);
      if (!leagueId) continue;
      if (!gradesByLeague.has(leagueId)) gradesByLeague.set(leagueId, []);
      gradesByLeague.get(leagueId)!.push(g);
    }

    ctx.log(`Found ${gradesByLeague.size} FAAB leagues with ${faabGrades.length} graded pickups`);

    if (gradesByLeague.size === 0) return noData("No FAAB leagues found");

    const ALPHA = QUALITY_WEIGHTS.waiver_score; // 0.40
    let withFaabWins = 0;
    let withoutFaabWins = 0;
    let ties = 0;
    const tableRows: (string | number)[][] = [];
    const faabBonusMagnitudes: number[] = [];

    for (const [leagueId, grades] of gradesByLeague) {
      const mosScores = await computeLeagueMOS(leagueId, undefined, db);
      if (mosScores.length < 3) continue;

      const ownerMos = new Map<string, number>();
      for (const s of mosScores) {
        const owner = rosterToOwner.get(`${s.leagueId}:${s.rosterId}`);
        if (owner) ownerMos.set(owner, s.mos);
      }
      if (ownerMos.size < 3) continue;

      // Aggregate two variants per manager
      const withFaab = new Map<string, { totalQ: number; totalPAR: number; count: number }>();
      const withoutFaab = new Map<string, { totalQ: number; totalPAR: number; count: number }>();

      for (const g of grades) {
        const lid = txLeague.get(g.transactionId);
        if (lid !== leagueId) continue;
        const ownerId = rosterToOwner.get(`${leagueId}:${g.rosterId}`);
        if (!ownerId) continue;

        const withScore = g.blendedScore ?? 0;
        // Strip FAAB bonus: recompute from value + production
        const pw = g.productionWeight ?? 0;
        const vs = g.valueScore ?? 50;
        const ps = g.productionScore ?? 50;
        const withoutScore = (1 - pw) * vs + pw * ps;

        const bonusDiff = withScore - withoutScore;
        if (bonusDiff > 0) faabBonusMagnitudes.push(bonusDiff);

        const par = g.rawPAR ?? 0;

        for (const [map, score] of [[withFaab, withScore], [withoutFaab, withoutScore]] as const) {
          if (!map.has(ownerId)) map.set(ownerId, { totalQ: 0, totalPAR: 0, count: 0 });
          const agg = map.get(ownerId)!;
          agg.totalQ += score;
          agg.totalPAR += par;
          agg.count++;
        }
      }

      // Blend quality x quantity for each variant
      const blendScores = (
        agg: Map<string, { totalQ: number; totalPAR: number; count: number }>,
      ): Map<string, number> => {
        const entries = Array.from(agg.entries()).filter(([, a]) => a.count > 0);
        if (entries.length === 0) return new Map();
        const pars = entries.map(([, a]) => a.totalPAR);
        const normalized = normalizeWithinLeague(pars);
        const result = new Map<string, number>();
        for (let i = 0; i < entries.length; i++) {
          const [id, a] = entries[i];
          const avgQ = a.totalQ / a.count;
          result.set(id, clamp(ALPHA * avgQ + (1 - ALPHA) * normalized[i], 0, 100));
        }
        return result;
      };

      const withScores = blendScores(withFaab);
      const withoutScores = blendScores(withoutFaab);

      // Correlate each against MOS
      const correlate = (scores: Map<string, number>): number => {
        const sArr: number[] = [];
        const mArr: number[] = [];
        for (const [owner, score] of scores) {
          const mos = ownerMos.get(owner);
          if (mos !== undefined) {
            sArr.push(score);
            mArr.push(mos);
          }
        }
        return sArr.length >= 3 ? spearmanCorrelation(sArr, mArr) : 0;
      };

      const withCorr = correlate(withScores);
      const withoutCorr = correlate(withoutScores);

      if (withCorr > withoutCorr) withFaabWins++;
      else if (withoutCorr > withCorr) withoutFaabWins++;
      else ties++;

      tableRows.push([leagueId.slice(0, 12), grades.length, round3(withCorr), round3(withoutCorr), withCorr > withoutCorr ? "with" : "without"]);
    }

    if (tableRows.length === 0) return noData("No FAAB leagues with sufficient data for correlation");

    ctx.log("\n--- Per-League FAAB Impact ---");
    printTable(
      ["League", "Pickups", "With FAAB", "Without FAAB", "Winner"],
      tableRows,
    );

    const bonusStats = describeArray(faabBonusMagnitudes);
    ctx.log(`\nFAAB bonus magnitude: mean=${bonusStats.mean}, median=${bonusStats.median}, max=${bonusStats.max}`);
    ctx.log(`With-FAAB wins: ${withFaabWins}, Without-FAAB wins: ${withoutFaabWins}, Ties: ${ties}`);

    const total = withFaabWins + withoutFaabWins + ties;
    const verdict = total < 3
      ? "inconclusive"
      : withFaabWins > withoutFaabWins
        ? "confirmed"
        : "rejected";

    return {
      verdict,
      verdictReason: `With-FAAB won ${withFaabWins}/${total} league-seasons (need >50%)`,
      scorecard: {
        primaryMetrics: [
          metric("FAAB leagues where bonus helps", withFaabWins, "count", { baseline: withoutFaabWins }),
        ],
        secondaryMetrics: [
          metric("Avg FAAB bonus magnitude", bonusStats.mean, "points"),
          metric("Total FAAB leagues", total, "count"),
        ],
        guardrailMetrics: [
          metric("Sample size", total, "leagues"),
        ],
      },
      metrics: { withFaabWins, withoutFaabWins, ties, bonusStats },
      rawData: tableRows.map((r) => ({
        league: r[0],
        pickups: r[1],
        withFaabCorr: r[2],
        withoutFaabCorr: r[3],
        winner: r[4],
      })),
    };
  },
});
