import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { and, inArray, sql } from "drizzle-orm";
import { enrichTransactions, buildRosterOwnerMap } from "@/lib/transactionEnrichment";
import { resolveFamily } from "@/lib/familyResolution";

// ============================================================
// Types
// ============================================================

interface StintData {
  rosterId: number | null;
  managerName: string | null;
  startSeason: string;
  startWeek: number;
  endSeason: string;
  endWeek: number;
  stats: {
    totalWeeks: number;
    gamesStarted: number;
    gamesActive: number;
    totalGames: number;
    pctStarted: number;
    pctActive: number;
    ppgWhenStarted: number;
    ppgWhenActive: number;
    totalPoints: number;
    hasNflData: boolean;
  } | null;
}

interface EventData {
  id: string;
  season: string;
  week: number;
  eventType: string;
  createdAt: number | null;
  transaction: ReturnType<typeof formatEnrichedTx> | null;
  draftDetails?: { pickNo: number; round: number; isKeeper: boolean };
}

function formatEnrichedTx(tx: Awaited<ReturnType<typeof enrichTransactions>>[0]) {
  return tx;
}

function isDraftDetails(obj: unknown): obj is { pickNo: number; round: number; isKeeper: boolean } {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.pickNo === "number" && typeof o.round === "number" && typeof o.isKeeper === "boolean";
}

// ============================================================
// Route handler
// ============================================================

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  const db = getDb();
  const familyId = params.familyId;
  const playerId = req.nextUrl.searchParams.get("playerId");
  const pickSeason = req.nextUrl.searchParams.get("pickSeason");
  const pickRound = req.nextUrl.searchParams.get("pickRound");
  const pickOriginalRosterId = req.nextUrl.searchParams.get("pickOriginalRosterId");

  if (!playerId && !(pickSeason && pickRound && pickOriginalRosterId)) {
    return NextResponse.json(
      { error: "Provide playerId or pickSeason+pickRound+pickOriginalRosterId" },
      { status: 400 }
    );
  }

  // Validate numeric params
  if (pickRound && isNaN(parseInt(pickRound, 10))) {
    return NextResponse.json({ error: "pickRound must be a number" }, { status: 400 });
  }
  if (pickOriginalRosterId && isNaN(parseInt(pickOriginalRosterId, 10))) {
    return NextResponse.json({ error: "pickOriginalRosterId must be a number" }, { status: 400 });
  }

  // Resolve family
  const resolvedFamilyId = await resolveFamily(familyId);
  if (!resolvedFamilyId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Get all league IDs in the family
  const members = await db
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, resolvedFamilyId));
  const allLeagueIds = members.map((m) => m.leagueId);
  const leagueSeasonMap = new Map(members.map((m) => [m.leagueId, m.season]));

  if (allLeagueIds.length === 0) {
    return NextResponse.json({ entries: [], asset: null });
  }

  // Build asset event query conditions
  const conditions = [inArray(schema.assetEvents.leagueId, allLeagueIds)];
  if (playerId) {
    conditions.push(eq(schema.assetEvents.playerId, playerId));
  } else {
    conditions.push(eq(schema.assetEvents.pickSeason, pickSeason!));
    conditions.push(eq(schema.assetEvents.pickRound, parseInt(pickRound!, 10)));
    conditions.push(eq(schema.assetEvents.pickOriginalRosterId, parseInt(pickOriginalRosterId!, 10)));
  }

  // Fetch events ordered chronologically
  const events = await db
    .select()
    .from(schema.assetEvents)
    .where(and(...conditions))
    .orderBy(
      sql`${schema.assetEvents.season} ASC`,
      sql`${schema.assetEvents.week} ASC`,
      sql`${schema.assetEvents.createdAt} ASC`
    );

  // Build roster owner map
  const rosterOwnerMap = await buildRosterOwnerMap(allLeagueIds);

  // Helper to get display name for a roster ID across leagues
  function getManagerName(rosterId: number | null): string | null {
    if (rosterId === null) return null;
    for (const [, rosterMap] of rosterOwnerMap) {
      const name = rosterMap.get(rosterId);
      if (name) return name;
    }
    return `Roster ${rosterId}`;
  }

  // Fetch and enrich transactions referenced by events
  const transactionIds = [...new Set(
    events.filter((e) => e.transactionId).map((e) => e.transactionId!)
  )];

  const enrichedTxMap = new Map<string, Awaited<ReturnType<typeof enrichTransactions>>[0]>();

  if (transactionIds.length > 0) {
    const rawTxs = await db
      .select()
      .from(schema.transactions)
      .where(inArray(schema.transactions.id, transactionIds));

    const enriched = await enrichTransactions(rawTxs, allLeagueIds, leagueSeasonMap, rosterOwnerMap);
    for (const tx of enriched) {
      enrichedTxMap.set(tx.id, tx);
    }
  }

  // Build asset info
  let asset = null;
  let playerGsisId: string | null = null;
  if (playerId) {
    const playerRows = await db
      .select()
      .from(schema.players)
      .where(eq(schema.players.id, playerId))
      .limit(1);
    if (playerRows.length > 0) {
      const p = playerRows[0];
      asset = {
        kind: "player" as const,
        playerId: p.id,
        name: p.name,
        position: p.position,
        team: p.team,
      };
      playerGsisId = p.gsisId;
    }
  } else {
    // For pick assets, try to look up original owner name
    const originalOwnerName = getManagerName(parseInt(pickOriginalRosterId!, 10));
    asset = {
      kind: "pick" as const,
      pickSeason: pickSeason!,
      pickRound: parseInt(pickRound!, 10),
      pickOriginalOwner: originalOwnerName,
    };
  }

  // ============================================================
  // Compute stints between events
  // ============================================================

  type StintBoundary = {
    rosterId: number | null;
    season: string;
    week: number;
  };

  const stintBoundaries: StintBoundary[] = [];

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    stintBoundaries.push({
      rosterId: e.toRosterId,
      season: e.season,
      week: e.week,
    });
  }

  // Build stints from boundaries
  const stints: StintData[] = [];
  for (let i = 0; i < stintBoundaries.length; i++) {
    const boundary = stintBoundaries[i];
    const startSeason = boundary.season;
    const startWeek = boundary.week;

    let endSeason: string;
    let endWeek: number;
    if (i + 1 < stintBoundaries.length) {
      endSeason = stintBoundaries[i + 1].season;
      endWeek = stintBoundaries[i + 1].week;
    } else {
      // Last stint extends to "now"
      endSeason = "now";
      endWeek = 0;
    }

    stints.push({
      rosterId: boundary.rosterId,
      managerName: getManagerName(boundary.rosterId),
      startSeason,
      startWeek,
      endSeason,
      endWeek,
      stats: null, // Will be computed below for player assets
    });
  }

  // ============================================================
  // Compute stint stats (player assets only)
  // ============================================================

  if (playerId && stints.length > 0) {
    // Fetch all scoring data for this player across family leagues
    const scoringRows = await db
      .select({
        leagueId: schema.playerScores.leagueId,
        week: schema.playerScores.week,
        rosterId: schema.playerScores.rosterId,
        points: schema.playerScores.points,
        isStarter: schema.playerScores.isStarter,
      })
      .from(schema.playerScores)
      .where(
        and(
          inArray(schema.playerScores.leagueId, allLeagueIds),
          eq(schema.playerScores.playerId, playerId),
        )
      );

    // Fetch NFL roster status for active weeks count
    let nflStatusRows: Array<{ season: number; week: number; status: string }> = [];
    if (playerGsisId) {
      nflStatusRows = await db
        .select({
          season: schema.nflWeeklyRosterStatus.season,
          week: schema.nflWeeklyRosterStatus.week,
          status: schema.nflWeeklyRosterStatus.status,
        })
        .from(schema.nflWeeklyRosterStatus)
        .where(eq(schema.nflWeeklyRosterStatus.gsisId, playerGsisId));
    }

    // Build a set of NFL active weeks: "season:week"
    const nflActiveWeeks = new Set<string>();
    for (const row of nflStatusRows) {
      if (row.status === "ACT") {
        nflActiveWeeks.add(`${row.season}:${row.week}`);
      }
    }

    // Annotate scoring rows with season via leagueSeasonMap
    const annotatedScoring = scoringRows.map((r) => ({
      ...r,
      season: leagueSeasonMap.get(r.leagueId) || "",
    }));

    // For each stint, compute stats
    for (const stint of stints) {
      if (stint.rosterId === null) continue; // Free agent stint — no stats

      // Filter scoring rows that fall within this stint's boundaries
      const stintScoring = annotatedScoring.filter((r) => {
        if (r.rosterId !== stint.rosterId) return false;

        const rSeasonNum = parseInt(r.season, 10);
        const startNum = parseInt(stint.startSeason, 10);
        const endNum = stint.endSeason === "now" ? 9999 : parseInt(stint.endSeason, 10);

        if (rSeasonNum < startNum || rSeasonNum > endNum) return false;
        if (rSeasonNum === startNum && r.week < stint.startWeek) return false;
        if (stint.endSeason !== "now" && rSeasonNum === endNum && r.week >= stint.endWeek) return false;

        return true;
      });

      if (stintScoring.length === 0) continue;

      const totalWeeks = stintScoring.length;
      const gamesStarted = stintScoring.filter((r) => r.isStarter).length;
      const totalPoints = stintScoring.reduce((sum, r) => sum + (r.points || 0), 0);
      const starterPoints = stintScoring
        .filter((r) => r.isStarter)
        .reduce((sum, r) => sum + (r.points || 0), 0);

      // Count NFL-active weeks within stint range
      let gamesActive = 0;
      let totalGames = 0;
      for (const r of stintScoring) {
        const key = `${r.season}:${r.week}`;
        totalGames++;
        if (nflActiveWeeks.has(key)) gamesActive++;
      }

      // PPG when active (among started weeks where player was NFL-active)
      const activeStartedScoring = stintScoring.filter((r) => {
        const key = `${r.season}:${r.week}`;
        return r.isStarter && nflActiveWeeks.has(key);
      });
      const ppgWhenActive = activeStartedScoring.length > 0
        ? activeStartedScoring.reduce((sum, r) => sum + (r.points || 0), 0) / activeStartedScoring.length
        : 0;

      const hasNflData = nflStatusRows.length > 0;

      stint.stats = {
        totalWeeks,
        gamesStarted,
        gamesActive,
        totalGames,
        pctStarted: totalWeeks > 0 ? Math.round((gamesStarted / totalWeeks) * 10000) / 10000 : 0,
        pctActive: hasNflData && totalGames > 0 ? Math.round((gamesActive / totalGames) * 10000) / 10000 : 0,
        ppgWhenStarted: gamesStarted > 0 ? Math.round((starterPoints / gamesStarted) * 100) / 100 : 0,
        ppgWhenActive: hasNflData ? Math.round(ppgWhenActive * 100) / 100 : 0,
        totalPoints,
        hasNflData,
      };
    }
  }

  // ============================================================
  // Interleave events and stints into entries array
  // ============================================================

  const entries: Array<
    | { type: "event"; event: EventData }
    | { type: "stint"; stint: StintData }
  > = [];

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const details = e.details;

    const eventData: EventData = {
      id: e.id,
      season: e.season,
      week: e.week,
      eventType: e.eventType,
      createdAt: e.createdAt,
      transaction: e.transactionId ? enrichedTxMap.get(e.transactionId) || null : null,
      ...(e.eventType === "draft_selected" && isDraftDetails(details)
        ? { draftDetails: { pickNo: details.pickNo, round: details.round, isKeeper: details.isKeeper } }
        : {}),
    };

    entries.push({ type: "event", event: eventData });

    // Add the stint that follows this event (if any)
    if (i < stints.length) {
      entries.push({ type: "stint", stint: stints[i] });
    }
  }

  return NextResponse.json({ asset, entries });
}
