import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { resolveFamily } from "@/lib/familyResolution";
import { getDemoSwapForRequest } from "@/lib/demoServer";
import { lookupSwap } from "@/lib/demoAnonymize";

/**
 * GET /api/leagues/[familyId]/player/[playerId]/weekly-log
 *
 * Returns week-by-week data for a player across all seasons in a league family:
 * - Which manager rostered them
 * - Started or benched in fantasy
 * - Lineup slot (WR, FLEX, SUPER_FLEX, etc.)
 * - NFL roster status (ACT, RES, INA, etc.)
 * - Fantasy points scored
 *
 * Query params:
 *   ?rosterId=3           — filter to specific roster/manager
 *   ?starterOnly=true     — only show weeks where player was started
 *
 * Season filtering is intentionally client-side — `currentManager` and
 * `rosteredSince` must always reflect the all-time identity of the player,
 * not the selected season window.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string; playerId: string } }
) {
  const db = getDb();
  const { familyId, playerId } = params;
  const searchParams = req.nextUrl.searchParams;
  const rosterIdFilter = searchParams.get("rosterId");
  const starterOnly = searchParams.get("starterOnly") === "true";

  const resolvedFamilyId = await resolveFamily(familyId);
  if (!resolvedFamilyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const members = await db
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, resolvedFamilyId));

  const leagueIds = members.map((m) => m.leagueId);
  if (leagueIds.length === 0) {
    return NextResponse.json({ weeks: [], player: null, managers: [] });
  }

  const leagueSeasonMap = new Map(members.map((m) => [m.leagueId, m.season]));

  // --- Load player info ---
  const playerRows = await db
    .select()
    .from(schema.players)
    .where(eq(schema.players.id, playerId))
    .limit(1);

  const player = playerRows.length > 0
    ? {
        id: playerRows[0].id,
        name: playerRows[0].name,
        position: playerRows[0].position,
        team: playerRows[0].team,
        gsisId: playerRows[0].gsisId,
        age: playerRows[0].age,
        yearsExp: playerRows[0].yearsExp,
        status: playerRows[0].status,
        injuryStatus: playerRows[0].injuryStatus,
      }
    : null;

  // --- Load player_scores across all leagues ---
  const scoreConditions = [
    inArray(schema.playerScores.leagueId, leagueIds),
    eq(schema.playerScores.playerId, playerId),
  ];
  if (rosterIdFilter) {
    scoreConditions.push(
      eq(schema.playerScores.rosterId, parseInt(rosterIdFilter, 10))
    );
  }
  if (starterOnly) {
    scoreConditions.push(eq(schema.playerScores.isStarter, true));
  }

  const scores = await db
    .select()
    .from(schema.playerScores)
    .where(and(...scoreConditions))
    .orderBy(
      sql`${schema.playerScores.leagueId}`,
      sql`${schema.playerScores.week}`
    );

  // --- Load roster_positions for each league (for slot derivation) ---
  const leagueRows = await db
    .select({
      id: schema.leagues.id,
      rosterPositions: schema.leagues.rosterPositions,
    })
    .from(schema.leagues)
    .where(inArray(schema.leagues.id, leagueIds));

  const leagueRosterPositions = new Map<string, string[]>(
    leagueRows.map((l) => [l.id, (l.rosterPositions as string[]) || []])
  );

  // --- Load matchups for slot derivation ---
  // We need the starters array for each (leagueId, week, rosterId)
  // Build a set of keys we need
  const matchupKeys = new Set(
    scores.map((s) => `${s.leagueId}|${s.week}|${s.rosterId}`)
  );

  const matchupRows = await db
    .select({
      leagueId: schema.matchups.leagueId,
      week: schema.matchups.week,
      rosterId: schema.matchups.rosterId,
      starters: schema.matchups.starters,
    })
    .from(schema.matchups)
    .where(inArray(schema.matchups.leagueId, leagueIds));

  // Index matchups by key
  const matchupMap = new Map<string, string[]>();
  for (const m of matchupRows) {
    const key = `${m.leagueId}|${m.week}|${m.rosterId}`;
    if (matchupKeys.has(key)) {
      matchupMap.set(key, (m.starters as string[]) || []);
    }
  }

  // --- Load roster → owner mapping + user display names ---
  const rosterRows = await db
    .select()
    .from(schema.rosters)
    .where(inArray(schema.rosters.leagueId, leagueIds));

  const userRows = await db
    .select()
    .from(schema.leagueUsers)
    .where(inArray(schema.leagueUsers.leagueId, leagueIds));

  const demoSwap = await getDemoSwapForRequest(req, resolvedFamilyId);

  // leagueId → userId → displayName (already pseudonymized when demo is on)
  const userNameMap = new Map<string, string>();
  for (const u of userRows) {
    const swapped = demoSwap
      ? lookupSwap(demoSwap, u.userId)?.displayName
      : undefined;
    userNameMap.set(
      `${u.leagueId}|${u.userId}`,
      swapped ?? u.displayName ?? u.userId
    );
  }

  // leagueId → rosterId → { ownerId, displayName }
  const rosterOwnerMap = new Map<string, { ownerId: string; displayName: string }>();
  for (const r of rosterRows) {
    if (r.ownerId) {
      const displayName =
        userNameMap.get(`${r.leagueId}|${r.ownerId}`) || r.ownerId;
      rosterOwnerMap.set(`${r.leagueId}|${r.rosterId}`, {
        ownerId: r.ownerId,
        displayName,
      });
    }
  }

  // --- Load NFL roster status (if player has gsisId) ---
  const nflStatusMap = new Map<string, { status: string; statusAbbr: string | null; team: string | null }>();
  if (player?.gsisId) {
    const nflRows = await db
      .select()
      .from(schema.nflWeeklyRosterStatus)
      .where(eq(schema.nflWeeklyRosterStatus.gsisId, player.gsisId));

    for (const row of nflRows) {
      nflStatusMap.set(`${row.season}|${row.week}`, {
        status: row.status,
        statusAbbr: row.statusAbbr,
        team: row.team,
      });
    }
  }

  // teamScheduleMap: "{season}|{team}" → week → { opponent, isAway }
  // Drives both bye-week detection (team has no game that week) and the
  // Opponent column on the weekly log.
  const relevantSeasons = [...new Set(members.map((m) => parseInt(m.season, 10)))].filter((n) => !isNaN(n));
  const teamScheduleMap = new Map<string, Map<number, { opponent: string; isAway: boolean }>>();
  const seasonAllWeeks = new Map<number, Set<number>>();

  if (relevantSeasons.length > 0) {
    const scheduleRows = await db
      .select()
      .from(schema.nflSchedule)
      .where(inArray(schema.nflSchedule.season, relevantSeasons));

    for (const g of scheduleRows) {
      if (!seasonAllWeeks.has(g.season)) seasonAllWeeks.set(g.season, new Set());
      seasonAllWeeks.get(g.season)!.add(g.week);

      const homeKey = `${g.season}|${g.homeTeam}`;
      const awayKey = `${g.season}|${g.awayTeam}`;
      if (!teamScheduleMap.has(homeKey)) teamScheduleMap.set(homeKey, new Map());
      if (!teamScheduleMap.has(awayKey)) teamScheduleMap.set(awayKey, new Map());
      teamScheduleMap.get(homeKey)!.set(g.week, { opponent: g.awayTeam, isAway: false });
      teamScheduleMap.get(awayKey)!.set(g.week, { opponent: g.homeTeam, isAway: true });
    }
  }

  // Player's NFL team for a given (season, week). Falls back to nearby
  // weeks for traded/inactive players, then to player's current Sleeper
  // team — needed for bye detection and opponent lookup.
  function resolveTeam(seasonNum: number, week: number): string | null {
    const direct = nflStatusMap.get(`${seasonNum}|${week}`)?.team;
    if (direct) return direct;
    if (player?.gsisId) {
      for (let delta = 1; delta <= 18; delta++) {
        const before = nflStatusMap.get(`${seasonNum}|${week - delta}`);
        if (before?.team) return before.team;
        const after = nflStatusMap.get(`${seasonNum}|${week + delta}`);
        if (after?.team) return after.team;
      }
    }
    return player?.team ?? null;
  }

  const weeks = scores.map((s) => {
    const season = leagueSeasonMap.get(s.leagueId) || "";
    const seasonNum = parseInt(season, 10);

    const matchupKey = `${s.leagueId}|${s.week}|${s.rosterId}`;
    const starters = matchupMap.get(matchupKey) || [];
    const rosterPositions = leagueRosterPositions.get(s.leagueId) || [];
    let lineupSlot: string | null = null;
    if (s.isStarter) {
      const starterIdx = starters.indexOf(playerId);
      if (starterIdx >= 0 && starterIdx < rosterPositions.length) {
        lineupSlot = rosterPositions[starterIdx];
      }
    }

    const ownerKey = `${s.leagueId}|${s.rosterId}`;
    const owner = rosterOwnerMap.get(ownerKey);

    const nflStatus = nflStatusMap.get(`${seasonNum}|${s.week}`);

    const team = resolveTeam(seasonNum, s.week);
    let opponent: string | null = null;
    let isAway = false;
    let isByeWeek = false;
    if (team) {
      const game = teamScheduleMap.get(`${seasonNum}|${team}`)?.get(s.week);
      if (game) {
        opponent = game.opponent;
        isAway = game.isAway;
      } else if (seasonAllWeeks.get(seasonNum)?.has(s.week)) {
        isByeWeek = true;
      }
    }

    return {
      season,
      week: s.week,
      leagueId: s.leagueId,
      manager: owner
        ? { userId: owner.ownerId, displayName: owner.displayName, rosterId: s.rosterId }
        : null,
      fantasyStatus: s.isStarter ? "starter" : "bench",
      lineupSlot,
      points: s.points || 0,
      nflStatus: nflStatus?.status || null,
      nflStatusAbbr: nflStatus?.statusAbbr || null,
      isByeWeek,
      opponent,
      isAway,
    };
  });

  // Sort by season desc, week asc
  weeks.sort((a, b) => {
    const seasonDiff = parseInt(b.season, 10) - parseInt(a.season, 10);
    if (seasonDiff !== 0) return seasonDiff;
    return a.week - b.week;
  });

  // --- Build unique managers list for filter UI ---
  const managersMap = new Map<string, { userId: string; displayName: string }>();
  for (const w of weeks) {
    if (w.manager && !managersMap.has(w.manager.userId)) {
      managersMap.set(w.manager.userId, {
        userId: w.manager.userId,
        displayName: w.manager.displayName,
      });
    }
  }

  // --- Build available seasons for filter UI ---
  const availableSeasons = [
    ...new Set(members.map((m) => m.season)),
  ].sort((a, b) => parseInt(b, 10) - parseInt(a, 10));

  // --- Current manager: who rosters this player in the most recent league? ---
  let currentManager: {
    userId: string;
    rosterId: number;
    displayName: string;
    teamName: string | null;
    avatar: string | null;
    rosteredSince: { season: string; week: number } | null;
  } | null = null;

  const sortedMembers = [...members].sort(
    (a, b) => parseInt(b.season, 10) - parseInt(a.season, 10)
  );
  const currentLeagueId = sortedMembers[0]?.leagueId;

  if (currentLeagueId) {
    const owningRoster = rosterRows.find((r) => {
      if (r.leagueId !== currentLeagueId) return false;
      const players = (r.players as string[] | null) ?? [];
      return players.includes(playerId);
    });

    if (owningRoster?.ownerId) {
      const userRow = userRows.find(
        (u) =>
          u.leagueId === currentLeagueId && u.userId === owningRoster.ownerId
      );
      const swapped = demoSwap
        ? lookupSwap(demoSwap, owningRoster.ownerId)
        : undefined;
      const displayName =
        swapped?.displayName ?? userRow?.displayName ?? owningRoster.ownerId;
      const teamName = swapped?.teamName ?? userRow?.teamName ?? null;
      const avatarHash = demoSwap ? null : userRow?.avatar ?? null;
      const avatar = avatarHash
        ? `https://sleepercdn.com/avatars/thumbs/${avatarHash}`
        : null;

      // weeks is sorted season DESC, week ASC — iterating from the end walks
      // newest → oldest to find the start of the current contiguous stint.
      let rosteredSince: { season: string; week: number } | null = null;
      for (let i = weeks.length - 1; i >= 0; i--) {
        const w = weeks[i];
        if (w.manager?.userId === owningRoster.ownerId) {
          rosteredSince = { season: w.season, week: w.week };
        } else {
          break;
        }
      }

      currentManager = {
        userId: owningRoster.ownerId,
        rosterId: owningRoster.rosterId,
        displayName,
        teamName,
        avatar,
        rosteredSince,
      };
    }
  }

  return NextResponse.json({
    player,
    weeks,
    managers: Array.from(managersMap.values()),
    availableSeasons,
    currentManager,
  });
}
