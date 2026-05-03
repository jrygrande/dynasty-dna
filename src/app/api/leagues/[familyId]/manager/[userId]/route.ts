import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { resolveFamily } from "@/lib/familyResolution";
import { percentileToGrade } from "@/services/gradingCore";
import { getDemoSwapForRequest } from "@/lib/demoServer";
import { lookupSwap } from "@/lib/demoAnonymize";
import { getAllTimeStandings } from "@/services/familyStandings";
import { getActiveConfig } from "@/services/algorithmConfig";
import { PILLAR_KEYS } from "@/lib/pillars";

interface ScoreWithRank {
  value: number;
  grade: string;
  percentile: number;
  rank: number;
  total: number;
}

interface RecordRow {
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  recordRank: number;
  fptsRank: number;
  total: number;
}

interface RosterPlayer {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
  age: number | null;
  ppg: number | null;
  startPct: number | null;
}

interface RosterSnapshot {
  season: string;
  asOf: number | null;
  players: RosterPlayer[];
}

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
    const leagueToSeason = new Map(members.map((m) => [m.leagueId, m.season]));
    const seasonsNewestFirst = [...members].sort(
      (a, b) => Number(b.season) - Number(a.season),
    );
    const mostRecentLeagueId = seasonsNewestFirst[0].leagueId;
    const mostRecentSeason = seasonsNewestFirst[0].season;

    const algoConfig = await getActiveConfig();
    const pillarWeights = algoConfig.pillarWeights as Record<string, number>;

    const [
      users,
      allMetrics,
      recentTx,
      allRosters,
      leagueRows,
    ] = await Promise.all([
      db
        .select()
        .from(schema.leagueUsers)
        .where(inArray(schema.leagueUsers.leagueId, leagueIds)),
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
          draftPicks: schema.transactions.draftPicks,
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
        .orderBy(desc(schema.transactions.createdAt)),
      db
        .select()
        .from(schema.rosters)
        .where(inArray(schema.rosters.leagueId, leagueIds)),
      db
        .select({
          id: schema.leagues.id,
          settings: schema.leagues.settings,
          winnersBracket: schema.leagues.winnersBracket,
          lastSyncedAt: schema.leagues.lastSyncedAt,
        })
        .from(schema.leagues)
        .where(inArray(schema.leagues.id, leagueIds)),
    ]);

    const user = seasonsNewestFirst
      .map((m) => users.find((u) => u.leagueId === m.leagueId && u.userId === userId))
      .find(Boolean);
    if (!user) {
      return NextResponse.json(
        { error: "Manager not found" },
        { status: 404 },
      );
    }

    // Track this manager's rosters across leagues
    const myRosterByLeague = new Map<string, number>();
    for (const r of allRosters) {
      if (r.ownerId === userId) {
        myRosterByLeague.set(r.leagueId, r.rosterId);
      }
    }
    const managerRosterIds = new Set(
      [...myRosterByLeague.entries()].map(([lid, rid]) => `${lid}:${rid}`),
    );

    // ============================================================
    // Section 1: Stats header — record + PF + ranks
    // ============================================================

    // Per-season standings: rank within each season's roster set.
    const rostersByLeague = new Map<string, typeof allRosters>();
    for (const r of allRosters) {
      const list = rostersByLeague.get(r.leagueId) ?? [];
      list.push(r);
      rostersByLeague.set(r.leagueId, list);
    }

    const seasonStats: Record<string, RecordRow & { leagueId: string }> = {};
    for (const member of members) {
      const rs = rostersByLeague.get(member.leagueId) ?? [];
      const myRow = rs.find((r) => r.ownerId === userId);
      if (!myRow) continue;
      const sortedByWins = [...rs].sort(
        (a, b) => (b.wins ?? 0) - (a.wins ?? 0) || (b.fpts ?? 0) - (a.fpts ?? 0),
      );
      const sortedByFpts = [...rs].sort(
        (a, b) => (b.fpts ?? 0) - (a.fpts ?? 0) || (b.wins ?? 0) - (a.wins ?? 0),
      );
      const recordRank =
        sortedByWins.findIndex((r) => r.rosterId === myRow.rosterId) + 1;
      const fptsRank =
        sortedByFpts.findIndex((r) => r.rosterId === myRow.rosterId) + 1;
      seasonStats[member.season] = {
        leagueId: member.leagueId,
        wins: myRow.wins ?? 0,
        losses: myRow.losses ?? 0,
        ties: myRow.ties ?? 0,
        fpts: myRow.fpts ?? 0,
        recordRank,
        fptsRank,
        total: rs.length,
      };
    }

    // All-time aggregate: sum across seasons; rank by sum of wins (the
    // confirmed convention) within all family managers.
    const allTimeStandings = await getAllTimeStandings(members);
    const allTimeByOwner = new Map(allTimeStandings.map((s) => [s.ownerId, s]));
    const myAllTime = allTimeByOwner.get(userId);
    const sortedByAllTimeWins = [...allTimeStandings].sort(
      (a, b) => b.wins - a.wins || b.fpts - a.fpts,
    );
    const sortedByAllTimeFpts = [...allTimeStandings].sort(
      (a, b) => b.fpts - a.fpts || b.wins - a.wins,
    );
    const allTimeRecordRank = myAllTime
      ? sortedByAllTimeWins.findIndex((s) => s.ownerId === userId) + 1
      : 0;
    const allTimeFptsRank = myAllTime
      ? sortedByAllTimeFpts.findIndex((s) => s.ownerId === userId) + 1
      : 0;
    const allTimeTotal = allTimeStandings.length;

    const allTime: RecordRow = {
      wins: myAllTime?.wins ?? 0,
      losses: myAllTime?.losses ?? 0,
      ties: myAllTime?.ties ?? 0,
      fpts: myAllTime?.fpts ?? 0,
      recordRank: allTimeRecordRank,
      fptsRank: allTimeFptsRank,
      total: allTimeTotal,
    };

    const championshipYears = myAllTime?.championshipYears ?? [];

    // ============================================================
    // Sections 2 + 3: MPS / pillar scores with rank framing.
    //
    // Pre-bucket allMetrics once instead of `filter`/`find` per call —
    // the season-MPS loop multiplies `seasons × managers × pillars` and
    // a naive O(n) scan per cell is the slowest thing on the page.
    // ============================================================

    const peersSortedAsc = new Map<string, number[]>(); // `${metric}|${scope}` → ascending
    const myMetricByKey = new Map<string, number>(); // `${metric}|${scope}` → my value
    const valueByMgrKey = new Map<string, number>(); // `${metric}|${scope}|${managerId}` → value
    const seasonScopes = new Set<string>();
    const managerIdsInScope = new Set<string>();

    for (const m of allMetrics) {
      const ms = `${m.metric}|${m.scope}`;
      const list = peersSortedAsc.get(ms) ?? [];
      list.push(m.value);
      peersSortedAsc.set(ms, list);
      valueByMgrKey.set(`${ms}|${m.managerId}`, m.value);
      if (m.managerId === userId) myMetricByKey.set(ms, m.value);
      if (m.scope.startsWith("season:")) seasonScopes.add(m.scope);
      managerIdsInScope.add(m.managerId);
    }
    for (const arr of peersSortedAsc.values()) arr.sort((a, b) => a - b);

    function scoreFromPeers(
      sortedAsc: number[] | undefined,
      managerValue: number,
    ): ScoreWithRank {
      const peers = sortedAsc ?? [];
      const lower = peers.filter((v) => v < managerValue).length;
      const equalOrLower = peers.filter((v) => v <= managerValue).length;
      const percentile =
        peers.length <= 1
          ? 50
          : Math.round((lower / (peers.length - 1)) * 1000) / 10;
      // Dense rank, 1-based, higher value = better rank.
      const rank = peers.length - equalOrLower + 1;
      return {
        value: managerValue,
        grade: percentileToGrade(percentile),
        percentile,
        rank: Math.max(1, rank),
        total: peers.length,
      };
    }

    function buildScoreWithRank(
      metric: string,
      scope: string,
      managerValue: number,
    ): ScoreWithRank {
      return scoreFromPeers(peersSortedAsc.get(`${metric}|${scope}`), managerValue);
    }

    const pillarScores: Record<string, ScoreWithRank | null> = {};
    for (const pillar of PILLAR_KEYS) {
      const v = myMetricByKey.get(`${pillar}|all_time`);
      pillarScores[pillar] = v !== undefined
        ? buildScoreWithRank(pillar, "all_time", v)
        : null;
    }

    const mpsAllTimeValue = myMetricByKey.get("manager_process_score|all_time");
    const mps = mpsAllTimeValue !== undefined
      ? buildScoreWithRank("manager_process_score", "all_time", mpsAllTimeValue)
      : null;

    // Season MPS = weighted avg of pillar percentiles in that season.
    const seasonMpsByManager = new Map<string, Map<string, number>>();
    for (const scope of seasonScopes) {
      const mpsMap = new Map<string, number>();
      for (const mgrId of managerIdsInScope) {
        let weightedSum = 0;
        let totalWeight = 0;
        for (const pillar of PILLAR_KEYS) {
          const v = valueByMgrKey.get(`${pillar}|${scope}|${mgrId}`);
          if (v === undefined) continue;
          const peers = peersSortedAsc.get(`${pillar}|${scope}`);
          const pctl = peers && peers.length > 1
            ? Math.round(
                (peers.filter((p) => p < v).length / (peers.length - 1)) * 1000,
              ) / 10
            : 50;
          const w = pillarWeights[pillar] ?? 1;
          weightedSum += pctl * w;
          totalWeight += w;
        }
        if (totalWeight === 0) continue;
        mpsMap.set(mgrId, Math.round((weightedSum / totalWeight) * 10) / 10);
      }
      if (mpsMap.size > 0) seasonMpsByManager.set(scope, mpsMap);
    }

    const seasonHistory = Array.from(seasonScopes)
      .map((scope) => {
        const season = scope.replace("season:", "");
        const stats = seasonStats[season];
        const pillars: Record<string, ScoreWithRank | null> = {};
        for (const pillar of PILLAR_KEYS) {
          const v = valueByMgrKey.get(`${pillar}|${scope}|${userId}`);
          pillars[pillar] = v !== undefined
            ? buildScoreWithRank(pillar, scope, v)
            : null;
        }

        const mpsMap = seasonMpsByManager.get(scope);
        const myMps = mpsMap?.get(userId);
        const seasonMpsScore = myMps !== undefined && mpsMap
          ? scoreFromPeers([...mpsMap.values()].sort((a, b) => a - b), myMps)
          : null;

        return {
          season,
          wins: stats?.wins ?? 0,
          losses: stats?.losses ?? 0,
          ties: stats?.ties ?? 0,
          fpts: stats?.fpts ?? 0,
          mps: seasonMpsScore,
          pillars,
        };
      })
      .sort((a, b) => b.season.localeCompare(a.season));

    // ============================================================
    // Section 5: Roster snapshots with PPG + Start% (bye-excluded)
    // ============================================================

    function rosterPlayersFor(leagueId: string): string[] {
      const myRow = (rostersByLeague.get(leagueId) ?? []).find(
        (r) => r.ownerId === userId,
      );
      const ids = (myRow?.players as string[] | null) ?? [];
      return ids.filter(Boolean);
    }

    // Collect every player ID we'll need metadata for in one shot —
    // displayed roster snapshots + add/drop/pick players in transactions
    // the manager touched. Avoids a second player-fetch round-trip later.
    const rosterDisplayedPlayerIds = new Set<string>();
    for (const member of members) {
      for (const pid of rosterPlayersFor(member.leagueId)) {
        rosterDisplayedPlayerIds.add(pid);
      }
    }

    const earlyManagerTx = recentTx.filter((tx) => {
      const adds = (tx.adds || {}) as Record<string, number>;
      const drops = (tx.drops || {}) as Record<string, number>;
      for (const rid of Object.values(adds)) {
        if (managerRosterIds.has(`${tx.leagueId}:${rid}`)) return true;
      }
      for (const rid of Object.values(drops)) {
        if (managerRosterIds.has(`${tx.leagueId}:${rid}`)) return true;
      }
      const picks = (tx.draftPicks || []) as Array<{
        owner_id: number;
        previous_owner_id: number;
      }>;
      for (const p of picks) {
        if (managerRosterIds.has(`${tx.leagueId}:${p.owner_id}`)) return true;
        if (managerRosterIds.has(`${tx.leagueId}:${p.previous_owner_id}`)) {
          return true;
        }
      }
      return false;
    });
    const allDisplayedPlayerIds = new Set(rosterDisplayedPlayerIds);
    for (const tx of earlyManagerTx) {
      const adds = (tx.adds || {}) as Record<string, number>;
      const drops = (tx.drops || {}) as Record<string, number>;
      for (const pid of Object.keys(adds)) allDisplayedPlayerIds.add(pid);
      for (const pid of Object.keys(drops)) allDisplayedPlayerIds.add(pid);
    }

    const myRosterIdList = [...new Set(allRosters
      .filter((r) => r.ownerId === userId)
      .map((r) => r.rosterId))];

    const seasonsAsNumbers = members
      .map((m) => Number(m.season))
      .filter((s) => !Number.isNaN(s));

    const [myScoreRows, snapshotPlayers] = await Promise.all([
      rosterDisplayedPlayerIds.size > 0 && myRosterIdList.length > 0
        ? db
            .select()
            .from(schema.playerScores)
            .where(
              and(
                inArray(schema.playerScores.leagueId, leagueIds),
                inArray(schema.playerScores.rosterId, myRosterIdList),
                inArray(
                  schema.playerScores.playerId,
                  [...rosterDisplayedPlayerIds],
                ),
              ),
            )
        : Promise.resolve([]),
      allDisplayedPlayerIds.size > 0
        ? db
            .select()
            .from(schema.players)
            .where(inArray(schema.players.id, [...allDisplayedPlayerIds]))
        : Promise.resolve([]),
    ]);

    // Belt-and-braces: roster IDs aren't unique across leagues, but the
    // (leagueId, rosterId) pair must belong to this manager.
    const myScoreRowsFiltered = myScoreRows.filter((r) =>
      managerRosterIds.has(`${r.leagueId}:${r.rosterId}`),
    );

    const playerById = new Map(snapshotPlayers.map((p) => [p.id, p]));

    // Bye detection only needs status rows for the displayed roster's
    // players. Without this filter we'd pull the full NFL weekly status
    // table (~3K player-weeks × seasons) on every request.
    const rosterGsisIds = [
      ...new Set(snapshotPlayers.map((p) => p.gsisId).filter((g): g is string => !!g)),
    ];

    const [statusRows, scheduleRows] = await Promise.all([
      seasonsAsNumbers.length > 0 && rosterGsisIds.length > 0
        ? db
            .select()
            .from(schema.nflWeeklyRosterStatus)
            .where(
              and(
                inArray(schema.nflWeeklyRosterStatus.season, seasonsAsNumbers),
                inArray(schema.nflWeeklyRosterStatus.gsisId, rosterGsisIds),
              ),
            )
        : Promise.resolve([]),
      seasonsAsNumbers.length > 0
        ? db
            .select()
            .from(schema.nflSchedule)
            .where(inArray(schema.nflSchedule.season, seasonsAsNumbers))
        : Promise.resolve([]),
    ]);

    const playerTeamByWeek = new Map<string, string>(); // `${gsisId}|${season}|${week}` → team
    for (const r of statusRows) {
      if (!r.team) continue;
      playerTeamByWeek.set(`${r.gsisId}|${r.season}|${r.week}`, r.team);
    }

    const teamPlayedWeeks = new Map<string, Set<number>>(); // `${season}|${team}` → weeks
    for (const g of scheduleRows) {
      const addTeam = (team: string) => {
        const key = `${g.season}|${team}`;
        const set = teamPlayedWeeks.get(key) ?? new Set<number>();
        set.add(g.week);
        teamPlayedWeeks.set(key, set);
      };
      addTeam(g.homeTeam);
      addTeam(g.awayTeam);
    }

    function isBye(playerId: string, season: string, week: number): boolean {
      const gsisId = playerById.get(playerId)?.gsisId;
      if (!gsisId) return false;
      // Status rows occasionally drop mid-season; fall back to the nearest
      // week with data so we don't misclassify byes.
      let team = playerTeamByWeek.get(`${gsisId}|${season}|${week}`) ?? null;
      if (!team) {
        for (let delta = 1; delta <= 18 && !team; delta++) {
          team =
            playerTeamByWeek.get(`${gsisId}|${season}|${week - delta}`) ??
            playerTeamByWeek.get(`${gsisId}|${season}|${week + delta}`) ??
            null;
        }
      }
      if (!team) return false;
      const weeksPlayed = teamPlayedWeeks.get(`${season}|${team}`);
      if (!weeksPlayed) return false;
      return !weeksPlayed.has(week);
    }

    interface PlayerStat {
      starts: number;
      total: number;
      points: number;
    }

    // Snapshots iterate over a small subset of leagues each — pre-bucket
    // scores by leagueId so we don't re-scan every score row per snapshot.
    const scoresByLeague = new Map<string, typeof myScoreRowsFiltered>();
    for (const r of myScoreRowsFiltered) {
      const list = scoresByLeague.get(r.leagueId) ?? [];
      list.push(r);
      scoresByLeague.set(r.leagueId, list);
    }

    function aggregatePlayerStats(
      playerIds: Set<string>,
      scopeLeagueIds: Iterable<string>,
    ): Map<string, PlayerStat> {
      const out = new Map<string, PlayerStat>();
      for (const pid of playerIds) out.set(pid, { starts: 0, total: 0, points: 0 });
      for (const lid of scopeLeagueIds) {
        const rows = scoresByLeague.get(lid);
        if (!rows) continue;
        const season = leagueToSeason.get(lid);
        if (!season) continue;
        for (const r of rows) {
          if (!playerIds.has(r.playerId)) continue;
          if (isBye(r.playerId, season, r.week)) continue;
          const stat = out.get(r.playerId)!;
          stat.total += 1;
          if (r.isStarter) stat.starts += 1;
          stat.points += r.points ?? 0;
        }
      }
      return out;
    }

    const leagueById = new Map(leagueRows.map((l) => [l.id, l]));

    function computeRosterSnapshot(
      season: string,
      leagueId: string,
      scopeLeagueIds: Iterable<string>,
    ): RosterSnapshot {
      const lastSync = leagueById.get(leagueId)?.lastSyncedAt;
      const ids = new Set(rosterPlayersFor(leagueId));
      const stats = aggregatePlayerStats(ids, scopeLeagueIds);
      const list: RosterPlayer[] = [];
      for (const pid of ids) {
        const p = playerById.get(pid);
        const s = stats.get(pid)!;
        list.push({
          id: pid,
          name: p?.name ?? pid,
          position: p?.position ?? null,
          team: p?.team ?? null,
          age: p?.age ?? null,
          ppg: s.total > 0 ? Math.round((s.points / s.total) * 10) / 10 : null,
          startPct: s.total > 0 ? Math.round((s.starts / s.total) * 1000) / 10 : null,
        });
      }
      list.sort((a, b) => {
        const ap = positionOrder(a.position);
        const bp = positionOrder(b.position);
        if (ap !== bp) return ap - bp;
        return (b.ppg ?? 0) - (a.ppg ?? 0);
      });
      return {
        season,
        asOf: lastSync ? lastSync.getTime() : null,
        players: list,
      };
    }

    // The "all-time" snapshot uses the most-recent roster but aggregates
    // PPG/Start% across every family league the manager played in.
    const rosters: Record<string, RosterSnapshot> = {
      "all-time": computeRosterSnapshot(
        mostRecentSeason,
        mostRecentLeagueId,
        leagueIds,
      ),
    };
    for (const member of members) {
      rosters[member.season] = computeRosterSnapshot(
        member.season,
        member.leagueId,
        [member.leagueId],
      );
    }

    // ============================================================
    // Transactions enrichment (filter computed earlier so we could batch
    // the players query into the main Promise.all)
    // ============================================================

    const managerTx = earlyManagerTx;
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

    function playerRef(pid: string) {
      const p = playerById.get(pid);
      return {
        id: pid,
        name: p?.name ?? pid,
        position: p?.position ?? null,
        team: p?.team ?? null,
      };
    }

    interface PickRef {
      season: string;
      round: number;
    }

    const enrichedTx = managerTx.map((tx) => {
      const adds = (tx.adds || {}) as Record<string, number>;
      const drops = (tx.drops || {}) as Record<string, number>;
      const draftPicks = (tx.draftPicks || []) as Array<{
        season: string;
        round: number;
        roster_id: number;
        previous_owner_id: number;
        owner_id: number;
      }>;
      const season = leagueToSeason.get(tx.leagueId) ?? "";
      const txGrade = gradeMap.get(tx.id);
      const myRosterId = myRosterByLeague.get(tx.leagueId);

      // Filter to the manager's side of the transaction. For waivers/free
      // agents this is a no-op (only one side); for trades it strips the
      // counterparty's assets so the card reads as "what I got / gave up".
      const myAdds = Object.entries(adds)
        .filter(([, rid]) => rid === myRosterId)
        .map(([pid]) => playerRef(pid));
      const myDrops = Object.entries(drops)
        .filter(([, rid]) => rid === myRosterId)
        .map(([pid]) => playerRef(pid));

      const picksReceived: PickRef[] = [];
      const picksSent: PickRef[] = [];
      for (const p of draftPicks) {
        if (p.owner_id === myRosterId && p.previous_owner_id !== myRosterId) {
          picksReceived.push({ season: p.season, round: p.round });
        } else if (
          p.previous_owner_id === myRosterId &&
          p.owner_id !== myRosterId
        ) {
          picksSent.push({ season: p.season, round: p.round });
        }
      }

      return {
        id: tx.id,
        type: tx.type,
        season,
        week: tx.week,
        adds: myAdds,
        drops: myDrops,
        picksReceived,
        picksSent,
        grade: txGrade?.grade ?? null,
        score: txGrade?.score ?? null,
        createdAt: tx.createdAt,
      };
    });

    const demoSwap = await getDemoSwapForRequest(req, familyId);
    const swap = demoSwap ? lookupSwap(demoSwap, user.userId) : undefined;

    return NextResponse.json({
      manager: {
        userId: user.userId,
        displayName: swap?.displayName ?? user.displayName,
        teamName: swap?.teamName ?? user.teamName,
        avatar: swap ? null : user.avatar,
      },
      allTime,
      seasonStats,
      championshipYears,
      mps,
      pillarScores,
      seasonHistory,
      rosters,
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

const POSITION_ORDER: Record<string, number> = {
  QB: 0,
  RB: 1,
  WR: 2,
  TE: 3,
  K: 4,
  DEF: 5,
};
function positionOrder(position: string | null): number {
  if (!position) return 99;
  return POSITION_ORDER[position] ?? 50;
}

