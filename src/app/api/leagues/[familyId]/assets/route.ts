/**
 * GET /api/leagues/:familyId/assets
 *
 * Returns a lightweight, picker-ready listing of all distinct players and
 * draft picks that appear in the league family's asset event log. Used by
 * the asset graph's empty-state picker.
 *
 * Public-by-design (matches /graph and other family routes).
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { resolveFamily } from "@/lib/familyResolution";
import { resolveDraftPicks, findOriginalSlot, calculatePickNumber } from "@/lib/draft";
import { pickKey } from "@/lib/assetGraph";
import { getDemoSwapForRequest } from "@/lib/demoServer";
import { lookupSwap } from "@/lib/demoAnonymize";

export interface AssetsListResponse {
  players: Array<{
    id: string;
    name: string;
    position: string | null;
    team: string | null;
  }>;
  picks: Array<{
    key: string;
    leagueId: string;
    season: string;
    round: number;
    originalRosterId: number;
    originalOwnerName: string | null;
    resolvedPlayerName: string | null;
  }>;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } },
) {
  const db = getDb();

  const resolvedFamilyId = await resolveFamily(params.familyId);
  if (!resolvedFamilyId) {
    return NextResponse.json({ error: "League family not found" }, { status: 404 });
  }

  const members = await db
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, resolvedFamilyId));
  const allLeagueIds = members.map((m) => m.leagueId);

  if (allLeagueIds.length === 0) {
    const empty: AssetsListResponse = { players: [], picks: [] };
    return NextResponse.json(empty);
  }

  // Most-recent two seasons of the family — used for the "points" component
  // of the player relevance sort.
  const recentSeasons = Array.from(new Set(members.map((m) => m.season)))
    .sort((a, b) => Number(b) - Number(a))
    .slice(0, 2);
  const recentSeasonsSet = new Set(recentSeasons);
  const recentLeagueIds = members
    .filter((m) => recentSeasonsSet.has(m.season))
    .map((m) => m.leagueId);

  // ---- Distinct players from assetEvents ----
  const playerRows = await db
    .selectDistinct({ playerId: schema.assetEvents.playerId })
    .from(schema.assetEvents)
    .where(
      and(
        inArray(schema.assetEvents.leagueId, allLeagueIds),
        isNotNull(schema.assetEvents.playerId),
      ),
    );
  const playerIds = playerRows
    .map((r) => r.playerId)
    .filter((id): id is string => Boolean(id));

  const playerMeta =
    playerIds.length > 0
      ? await db
          .select({
            id: schema.players.id,
            name: schema.players.name,
            position: schema.players.position,
            team: schema.players.team,
          })
          .from(schema.players)
          .where(inArray(schema.players.id, playerIds))
      : [];

  // ---- Relevance signals: lifetime trades + recent points ----
  const [playerTradeRows, playerPointsRows] = await Promise.all([
    db
      .select({
        playerId: schema.assetEvents.playerId,
        trades: sql<number>`count(*)`,
      })
      .from(schema.assetEvents)
      .where(
        and(
          inArray(schema.assetEvents.leagueId, allLeagueIds),
          eq(schema.assetEvents.eventType, "trade"),
          eq(schema.assetEvents.assetKind, "player"),
          isNotNull(schema.assetEvents.playerId),
        ),
      )
      .groupBy(schema.assetEvents.playerId),
    recentLeagueIds.length > 0
      ? db
          .select({
            playerId: schema.playerScores.playerId,
            points: sql<number>`coalesce(sum(${schema.playerScores.points}), 0)`,
          })
          .from(schema.playerScores)
          .where(inArray(schema.playerScores.leagueId, recentLeagueIds))
          .groupBy(schema.playerScores.playerId)
      : Promise.resolve([] as Array<{ playerId: string; points: number }>),
  ]);

  const playerTradeMap = new Map<string, number>();
  for (const row of playerTradeRows) {
    if (row.playerId) playerTradeMap.set(row.playerId, Number(row.trades));
  }
  const playerPointsMap = new Map<string, number>();
  for (const row of playerPointsRows) {
    playerPointsMap.set(row.playerId, Number(row.points));
  }

  // Min-max normalize each signal independently, then sum so points and
  // trades contribute equally regardless of their raw scale.
  let maxPlayerPoints = 0;
  let maxPlayerTrades = 0;
  for (const p of playerMeta) {
    maxPlayerPoints = Math.max(maxPlayerPoints, playerPointsMap.get(p.id) ?? 0);
    maxPlayerTrades = Math.max(maxPlayerTrades, playerTradeMap.get(p.id) ?? 0);
  }
  const playerRelevanceMap = new Map<string, number>();
  for (const p of playerMeta) {
    const points = playerPointsMap.get(p.id) ?? 0;
    const trades = playerTradeMap.get(p.id) ?? 0;
    const score =
      (maxPlayerPoints > 0 ? points / maxPlayerPoints : 0) +
      (maxPlayerTrades > 0 ? trades / maxPlayerTrades : 0);
    playerRelevanceMap.set(p.id, score);
  }

  // Only include players we can identify; orphan IDs are filtered out — see issue #105.
  const players = playerMeta
    .map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team }))
    .sort((a, b) => {
      const diff =
        (playerRelevanceMap.get(b.id) ?? 0) - (playerRelevanceMap.get(a.id) ?? 0);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    });

  // ---- Distinct picks from assetEvents ----
  const pickRows = await db
    .selectDistinct({
      leagueId: schema.assetEvents.leagueId,
      pickSeason: schema.assetEvents.pickSeason,
      pickRound: schema.assetEvents.pickRound,
      pickOriginalRosterId: schema.assetEvents.pickOriginalRosterId,
    })
    .from(schema.assetEvents)
    .where(
      and(
        inArray(schema.assetEvents.leagueId, allLeagueIds),
        isNotNull(schema.assetEvents.pickSeason),
        isNotNull(schema.assetEvents.pickRound),
        isNotNull(schema.assetEvents.pickOriginalRosterId),
      ),
    );

  // ---- Pick trade counts (lifetime) for relevance sort ----
  const pickTradeRows = await db
    .select({
      pickSeason: schema.assetEvents.pickSeason,
      pickRound: schema.assetEvents.pickRound,
      pickOriginalRosterId: schema.assetEvents.pickOriginalRosterId,
      trades: sql<number>`count(*)`,
    })
    .from(schema.assetEvents)
    .where(
      and(
        inArray(schema.assetEvents.leagueId, allLeagueIds),
        eq(schema.assetEvents.eventType, "pick_trade"),
        isNotNull(schema.assetEvents.pickSeason),
        isNotNull(schema.assetEvents.pickRound),
        isNotNull(schema.assetEvents.pickOriginalRosterId),
      ),
    )
    .groupBy(
      schema.assetEvents.pickSeason,
      schema.assetEvents.pickRound,
      schema.assetEvents.pickOriginalRosterId,
    );
  const pickTradeMap = new Map<string, number>();
  for (const row of pickTradeRows) {
    if (
      row.pickSeason !== null &&
      row.pickRound !== null &&
      row.pickOriginalRosterId !== null
    ) {
      const key = pickKey({
        pickSeason: row.pickSeason,
        pickRound: row.pickRound,
        pickOriginalRosterId: row.pickOriginalRosterId,
      });
      pickTradeMap.set(key, Number(row.trades));
    }
  }

  // ---- Original-owner display names: rosters -> leagueUsers ----
  const [rosters, users] = await Promise.all([
    db
      .select()
      .from(schema.rosters)
      .where(inArray(schema.rosters.leagueId, allLeagueIds)),
    db
      .select()
      .from(schema.leagueUsers)
      .where(inArray(schema.leagueUsers.leagueId, allLeagueIds)),
  ]);

  const demoSwap = await getDemoSwapForRequest(req, resolvedFamilyId);

  // userId -> displayName (prefer non-empty; pseudonymized in demo mode)
  const userIdToName = new Map<string, string>();
  for (const u of users) {
    const swapped = demoSwap
      ? lookupSwap(demoSwap, u.userId)?.displayName
      : undefined;
    const name = swapped ?? u.displayName;
    if (!name) continue;
    if (!userIdToName.has(u.userId)) userIdToName.set(u.userId, name);
  }
  // (leagueId:rosterId) -> userId
  const rosterToUser = new Map<string, string>();
  for (const r of rosters) {
    if (!r.ownerId) continue;
    rosterToUser.set(`${r.leagueId}:${r.rosterId}`, r.ownerId);
  }

  // ---- Resolve drafted player for completed picks ----
  const { draftsBySeason, draftPicksMap } = await resolveDraftPicks(allLeagueIds);
  const resolvedPlayerIds = new Set<string>();
  const draftResolutions = new Map<string, string>(); // pickKey -> playerId

  for (const row of pickRows) {
    if (!row.pickSeason || row.pickRound === null || row.pickOriginalRosterId === null) {
      continue;
    }
    const draftInfo = draftsBySeason.get(row.pickSeason);
    if (!draftInfo || !draftInfo.slotToRosterId || draftInfo.status !== "complete") {
      continue;
    }
    const originalSlot = findOriginalSlot(
      draftInfo.slotToRosterId,
      row.pickOriginalRosterId,
    );
    if (originalSlot === null) continue;
    const pickNo = calculatePickNumber(
      row.pickRound,
      originalSlot,
      draftInfo.totalRosters,
      draftInfo.type === "snake",
    );
    const playerId = draftPicksMap.get(draftInfo.draftId)?.get(pickNo);
    if (!playerId) continue;
    resolvedPlayerIds.add(playerId);
    draftResolutions.set(
      pickKey({
        pickSeason: row.pickSeason,
        pickRound: row.pickRound,
        pickOriginalRosterId: row.pickOriginalRosterId,
      }),
      playerId,
    );
  }

  // Map resolved player IDs to names. Most are already in playerMeta; query
  // the rest in one go.
  const knownPlayerNames = new Map<string, string>();
  for (const p of playerMeta) knownPlayerNames.set(p.id, p.name);
  const missing = Array.from(resolvedPlayerIds).filter((id) => !knownPlayerNames.has(id));
  if (missing.length > 0) {
    const extra = await db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players)
      .where(inArray(schema.players.id, missing));
    for (const p of extra) knownPlayerNames.set(p.id, p.name);
  }

  const picks = pickRows
    .filter(
      (r): r is typeof r & {
        pickSeason: string;
        pickRound: number;
        pickOriginalRosterId: number;
      } =>
        r.pickSeason !== null &&
        r.pickRound !== null &&
        r.pickOriginalRosterId !== null,
    )
    .map((r) => {
      const ownerUserId = rosterToUser.get(`${r.leagueId}:${r.pickOriginalRosterId}`);
      const ownerName = ownerUserId ? userIdToName.get(ownerUserId) ?? null : null;
      const key = pickKey({
        pickSeason: r.pickSeason,
        pickRound: r.pickRound,
        pickOriginalRosterId: r.pickOriginalRosterId,
      });
      const resolvedPlayerId = draftResolutions.get(key);
      return {
        key,
        leagueId: r.leagueId,
        season: r.pickSeason,
        round: r.pickRound,
        originalRosterId: r.pickOriginalRosterId,
        originalOwnerName: ownerName,
        resolvedPlayerName: resolvedPlayerId
          ? knownPlayerNames.get(resolvedPlayerId) ?? null
          : null,
      };
    })
    .sort((a, b) => {
      const tradeDiff =
        (pickTradeMap.get(b.key) ?? 0) - (pickTradeMap.get(a.key) ?? 0);
      if (tradeDiff !== 0) return tradeDiff;
      if (a.season !== b.season) return Number(b.season) - Number(a.season);
      if (a.round !== b.round) return a.round - b.round;
      return (a.originalOwnerName ?? "").localeCompare(b.originalOwnerName ?? "");
    });

  const response: AssetsListResponse = { players, picks };
  return NextResponse.json(response);
}
