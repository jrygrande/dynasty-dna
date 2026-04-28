import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { resolveFamily } from "@/lib/familyResolution";
import { percentileToGrade } from "@/services/gradingCore";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ familyId: string; userId: string }> },
) {
  try {
    const { familyId: rawFamilyId, userId } = await params;
    const db = getDb();

    const familyId = await resolveFamily(rawFamilyId);
    if (!familyId) {
      return NextResponse.json(
        { error: "League family not found" },
        { status: 404 },
      );
    }

    const members = await db
      .select()
      .from(schema.leagueFamilyMembers)
      .where(eq(schema.leagueFamilyMembers.familyId, familyId));

    if (members.length === 0) {
      return NextResponse.json(
        { error: "League family not found" },
        { status: 404 },
      );
    }

    const leagueIds = members.map((m) => m.leagueId);

    // Load user info, metrics, transactions, and rosters in parallel
    const [users, allMetrics, recentTx, rosters] = await Promise.all([
      db
        .select()
        .from(schema.leagueUsers)
        .where(
          and(
            inArray(schema.leagueUsers.leagueId, leagueIds),
            eq(schema.leagueUsers.userId, userId),
          ),
        ),
      db
        .select()
        .from(schema.managerMetrics)
        .where(inArray(schema.managerMetrics.leagueId, leagueIds)),
      db
        .select({
          id: schema.transactions.id,
          type: schema.transactions.type,
          leagueId: schema.transactions.leagueId,
          week: schema.transactions.week,
          adds: schema.transactions.adds,
          drops: schema.transactions.drops,
          createdAt: schema.transactions.createdAt,
        })
        .from(schema.transactions)
        .where(
          and(
            inArray(schema.transactions.leagueId, leagueIds),
            inArray(schema.transactions.type, [
              "trade",
              "waiver",
              "free_agent",
            ]),
          ),
        )
        .orderBy(desc(schema.transactions.createdAt))
        .limit(200),
      db
        .select({
          leagueId: schema.rosters.leagueId,
          rosterId: schema.rosters.rosterId,
        })
        .from(schema.rosters)
        .where(
          and(
            inArray(schema.rosters.leagueId, leagueIds),
            eq(schema.rosters.ownerId, userId),
          ),
        ),
    ]);

    const user = users[0];
    if (!user) {
      return NextResponse.json(
        { error: "Manager not found" },
        { status: 404 },
      );
    }

    const managerRosterIds = new Set(
      rosters.map((r) => `${r.leagueId}:${r.rosterId}`),
    );

    // Filter transactions to those involving this manager
    const managerTx = recentTx.filter((tx) => {
      const adds = (tx.adds || {}) as Record<string, number>;
      const drops = (tx.drops || {}) as Record<string, number>;
      for (const rid of Object.values(adds)) {
        if (managerRosterIds.has(`${tx.leagueId}:${rid}`)) return true;
      }
      for (const rid of Object.values(drops)) {
        if (managerRosterIds.has(`${tx.leagueId}:${rid}`)) return true;
      }
      return false;
    }).slice(0, 10);

    // Parse metrics — compute global percentiles across all managers
    const pillarTypes = [
      "trade_score",
      "draft_score",
      "waiver_score",
      "lineup_score",
    ];

    // Build global score distributions per metric+scope for percentile ranking
    const globalScores = new Map<string, number[]>(); // "metric:scope" -> sorted values
    for (const m of allMetrics) {
      const key = `${m.metric}:${m.scope}`;
      if (!globalScores.has(key)) globalScores.set(key, []);
      globalScores.get(key)!.push(m.value);
    }
    for (const arr of globalScores.values()) arr.sort((a, b) => a - b);

    function globalPercentile(metric: string, scope: string, value: number): number {
      const sorted = globalScores.get(`${metric}:${scope}`);
      if (!sorted || sorted.length <= 1) return 50;
      const rank = sorted.filter((v) => v < value).length;
      return Math.round((rank / (sorted.length - 1)) * 1000) / 10;
    }

    // Filter to this manager's metrics
    const myMetrics = allMetrics.filter((r) => r.managerId === userId);

    // All-time pillar scores with global percentile grades
    const pillarScores: Record<
      string,
      { value: number; grade: string; percentile: number } | null
    > = {};
    for (const pillar of pillarTypes) {
      const m = myMetrics.find(
        (r) => r.metric === pillar && r.scope === "all_time",
      );
      if (m) {
        const pctl = globalPercentile(pillar, "all_time", m.value);
        pillarScores[pillar] = {
          value: m.value,
          grade: percentileToGrade(pctl),
          percentile: pctl,
        };
      } else {
        pillarScores[pillar] = null;
      }
    }

    // Overall score
    const overallMetric = myMetrics.find(
      (r) => r.metric === "overall_score" && r.scope === "all_time",
    );
    const overallScore = overallMetric
      ? {
          value: overallMetric.value,
          grade: percentileToGrade(
            globalPercentile("overall_score", "all_time", overallMetric.value),
          ),
          percentile: globalPercentile(
            "overall_score",
            "all_time",
            overallMetric.value,
          ),
        }
      : null;

    // Season history — group season-scoped metrics by season
    const leagueToSeason = new Map(
      members.map((m) => [m.leagueId, m.season]),
    );
    const seasonMetrics = myMetrics.filter((r) =>
      r.scope.startsWith("season:"),
    );

    const seasonMap = new Map<
      string,
      Record<string, { value: number; grade: string; percentile: number }>
    >();
    for (const m of seasonMetrics) {
      const season = m.scope.replace("season:", "");
      if (!seasonMap.has(season)) seasonMap.set(season, {});
      const pctl = globalPercentile(m.metric, m.scope, m.value);
      seasonMap.get(season)![m.metric] = {
        value: m.value,
        grade: percentileToGrade(pctl),
        percentile: pctl,
      };
    }

    const seasonHistory = Array.from(seasonMap.entries())
      .map(([season, metrics]) => ({ season, ...metrics }))
      .sort((a, b) => b.season.localeCompare(a.season));

    // Load player names for transaction display
    const playerIds = new Set<string>();
    for (const tx of managerTx) {
      const adds = (tx.adds || {}) as Record<string, number>;
      const drops = (tx.drops || {}) as Record<string, number>;
      for (const pid of Object.keys(adds)) playerIds.add(pid);
      for (const pid of Object.keys(drops)) playerIds.add(pid);
    }

    const players =
      playerIds.size > 0
        ? await db
            .select({
              id: schema.players.id,
              firstName: schema.players.firstName,
              lastName: schema.players.lastName,
              position: schema.players.position,
              team: schema.players.team,
            })
            .from(schema.players)
            .where(inArray(schema.players.id, [...playerIds]))
        : [];

    const playerMap = new Map(
      players.map((p) => [
        p.id,
        {
          id: p.id,
          name: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.id,
          position: p.position,
          team: p.team,
        },
      ]),
    );

    // Load trade + waiver grades for these transactions
    const txIds = managerTx.map((tx) => tx.id);
    const [tradeGrades, waiverGrades] =
      txIds.length > 0
        ? await Promise.all([
            db
              .select({
                transactionId: schema.tradeGrades.transactionId,
                rosterId: schema.tradeGrades.rosterId,
                grade: schema.tradeGrades.grade,
                blendedScore: schema.tradeGrades.blendedScore,
              })
              .from(schema.tradeGrades)
              .where(inArray(schema.tradeGrades.transactionId, txIds)),
            db
              .select({
                transactionId: schema.waiverGrades.transactionId,
                rosterId: schema.waiverGrades.rosterId,
                grade: schema.waiverGrades.grade,
                blendedScore: schema.waiverGrades.blendedScore,
              })
              .from(schema.waiverGrades)
              .where(inArray(schema.waiverGrades.transactionId, txIds)),
          ])
        : [[], []];

    const txLeagueMap = new Map(managerTx.map((t) => [t.id, t.leagueId]));
    const gradeMap = new Map<string, { grade: string; score: number }>();
    for (const g of [...tradeGrades, ...waiverGrades]) {
      const txLeagueId = txLeagueMap.get(g.transactionId);
      if (txLeagueId && managerRosterIds.has(`${txLeagueId}:${g.rosterId}`)) {
        gradeMap.set(g.transactionId, {
          grade: g.grade ?? "",
          score: g.blendedScore ?? 0,
        });
      }
    }

    const enrichedTx = managerTx.map((tx) => {
      const adds = (tx.adds || {}) as Record<string, number>;
      const drops = (tx.drops || {}) as Record<string, number>;
      const season = leagueToSeason.get(tx.leagueId) ?? "";
      const txGrade = gradeMap.get(tx.id);

      return {
        id: tx.id,
        type: tx.type,
        season,
        week: tx.week,
        adds: Object.keys(adds).map((pid) => playerMap.get(pid) ?? { id: pid, name: pid, position: null, team: null }),
        drops: Object.keys(drops).map((pid) => playerMap.get(pid) ?? { id: pid, name: pid, position: null, team: null }),
        grade: txGrade?.grade ?? null,
        score: txGrade?.score ?? null,
        createdAt: tx.createdAt,
      };
    });

    return NextResponse.json({
      manager: {
        userId: user.userId,
        displayName: user.displayName,
        teamName: user.teamName,
        avatar: user.avatar,
      },
      overallScore,
      pillarScores,
      seasonHistory,
      recentTransactions: enrichedTx,
      seasons: members
        .map((m) => ({ leagueId: m.leagueId, season: m.season }))
        .sort((a, b) => b.season.localeCompare(a.season)),
    });
  } catch (err) {
    console.error("[manager API] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
