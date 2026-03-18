/**
 * Shared transaction enrichment logic.
 * Extracts the formatting/enrichment pipeline from the transactions API
 * so it can be reused by the asset-timeline API.
 */

import { getDb, schema } from "@/db";
import { inArray } from "drizzle-orm";
import { findOriginalSlot, calculatePickNumber, resolveDraftPicks } from "@/lib/draft";

// ============================================================
// Types (matches TransactionData in TransactionCard.tsx)
// ============================================================

export interface EnrichedTransaction {
  id: string;
  type: string;
  week: number;
  season: string;
  createdAt: number | null;
  managers: Array<{ rosterId: number; name: string }>;
  adds: Array<{
    playerId: string;
    playerName: string;
    rosterId: number;
    managerName: string;
  }>;
  drops: Array<{
    playerId: string;
    playerName: string;
    rosterId: number;
    managerName: string;
  }>;
  draftPicks: Array<{
    season: string;
    round: number;
    originalRosterId: number;
    originalOwnerName: string | null;
    fromRosterId: number;
    toRosterId: number;
    from: string;
    to: string;
    resolvedPlayerId?: string;
    resolvedPlayerName?: string;
  }>;
  settings: Record<string, unknown> | null;
  grades?: Array<{
    rosterId: number;
    grade: string | null;
    blendedScore: number | null;
    productionWeight: number | null;
    productionWeeks: number | null;
    fantasyCalcValue: number | null;
  }>;
}

// Raw transaction row from DB
export type RawTransaction = typeof schema.transactions.$inferSelect;

// ============================================================
// Shared helpers for building roster owner maps
// ============================================================

export async function buildRosterOwnerMap(
  allLeagueIds: string[],
): Promise<Map<string, Map<number, string>>> {
  const db = getDb();
  const rosterOwnerMap = new Map<string, Map<number, string>>();

  const allUsers = await db
    .select()
    .from(schema.leagueUsers)
    .where(inArray(schema.leagueUsers.leagueId, allLeagueIds));
  const allRosters = await db
    .select()
    .from(schema.rosters)
    .where(inArray(schema.rosters.leagueId, allLeagueIds));

  const usersByLeague = new Map<string, Map<string, string>>();
  for (const u of allUsers) {
    if (!usersByLeague.has(u.leagueId)) usersByLeague.set(u.leagueId, new Map());
    usersByLeague.get(u.leagueId)!.set(u.userId, u.displayName || u.userId);
  }

  for (const r of allRosters) {
    if (!r.ownerId) continue;
    if (!rosterOwnerMap.has(r.leagueId)) rosterOwnerMap.set(r.leagueId, new Map());
    const userMap = usersByLeague.get(r.leagueId);
    rosterOwnerMap.get(r.leagueId)!.set(r.rosterId, userMap?.get(r.ownerId) || r.ownerId);
  }

  return rosterOwnerMap;
}

// ============================================================
// Main enrichment function
// ============================================================

export async function enrichTransactions(
  rawTransactions: RawTransaction[],
  allLeagueIds: string[],
  leagueSeasonMap: Map<string, string>,
  rosterOwnerMap: Map<string, Map<number, string>>,
): Promise<EnrichedTransaction[]> {
  const db = getDb();

  // Collect all player IDs from adds/drops to fetch names
  const playerIds = new Set<string>();
  for (const tx of rawTransactions) {
    const adds = (tx.adds || {}) as Record<string, number>;
    const drops = (tx.drops || {}) as Record<string, number>;
    Object.keys(adds).forEach((id) => playerIds.add(id));
    Object.keys(drops).forEach((id) => playerIds.add(id));
  }

  // Fetch player names
  const playerNames = new Map<string, string>();
  if (playerIds.size > 0) {
    const players = await db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players)
      .where(inArray(schema.players.id, Array.from(playerIds)));
    for (const p of players) {
      playerNames.set(p.id, p.name);
    }
  }

  // Fetch trade grades for trade transactions
  const tradeTransactionIds = rawTransactions
    .filter((tx) => tx.type === "trade")
    .map((tx) => tx.id);

  const tradeGradesMap = new Map<
    string,
    Array<{
      rosterId: number;
      grade: string | null;
      blendedScore: number | null;
      productionWeight: number | null;
      productionWeeks: number | null;
      fantasyCalcValue: number | null;
    }>
  >();

  if (tradeTransactionIds.length > 0) {
    const grades = await db
      .select({
        transactionId: schema.tradeGrades.transactionId,
        rosterId: schema.tradeGrades.rosterId,
        grade: schema.tradeGrades.grade,
        blendedScore: schema.tradeGrades.blendedScore,
        productionWeight: schema.tradeGrades.productionWeight,
        productionWeeks: schema.tradeGrades.productionWeeks,
        fantasyCalcValue: schema.tradeGrades.fantasyCalcValue,
      })
      .from(schema.tradeGrades)
      .where(inArray(schema.tradeGrades.transactionId, tradeTransactionIds));

    for (const g of grades) {
      const existing = tradeGradesMap.get(g.transactionId) || [];
      existing.push({
        rosterId: g.rosterId,
        grade: g.grade,
        blendedScore: g.blendedScore,
        productionWeight: g.productionWeight,
        productionWeeks: g.productionWeeks,
        fantasyCalcValue: g.fantasyCalcValue,
      });
      tradeGradesMap.set(g.transactionId, existing);
    }
  }

  // Resolve draft picks
  const pickTuples: Array<{ season: string; round: number; roster_id: number }> = [];
  const tradeTxs = rawTransactions.filter((tx) => tx.type === "trade");
  const pickSeasons = new Set<string>();

  for (const tx of tradeTxs) {
    const dps = (tx.draftPicks || []) as Array<{
      season: string;
      round: number;
      roster_id: number;
      previous_owner_id: number;
      owner_id: number;
    }>;
    for (const dp of dps) {
      pickTuples.push({ season: dp.season, round: dp.round, roster_id: dp.roster_id });
      pickSeasons.add(dp.season);
    }
  }

  const resolvedPickMap = new Map<string, { playerId: string; playerName: string }>();
  const seasonToDraft = new Map<string, { id: string; leagueId: string; type: string | null }>();

  if (pickSeasons.size > 0) {
    const { draftsBySeason, draftPicksMap } = await resolveDraftPicks(
      allLeagueIds,
      { seasons: Array.from(pickSeasons) },
    );

    const draftsForSeasons = await db
      .select({
        id: schema.drafts.id,
        leagueId: schema.drafts.leagueId,
        season: schema.drafts.season,
        type: schema.drafts.type,
        status: schema.drafts.status,
      })
      .from(schema.drafts)
      .where(
        inArray(schema.drafts.leagueId, allLeagueIds),
      );

    for (const d of draftsForSeasons) {
      if (d.status === "complete" && pickSeasons.has(d.season)) {
        seasonToDraft.set(d.season, { id: d.id, leagueId: d.leagueId, type: d.type });
      }
    }

    const resolvedPlayerIds = new Set<string>();

    for (const tuple of pickTuples) {
      const draftInfo = draftsBySeason.get(tuple.season);
      if (!draftInfo || !draftInfo.slotToRosterId || draftInfo.status !== "complete") continue;

      const slotMap = draftInfo.slotToRosterId;
      const teams = draftInfo.totalRosters;
      const isSnake = draftInfo.type === "snake";

      const originalSlot = findOriginalSlot(slotMap, tuple.roster_id);
      if (originalSlot === null) continue;

      const pickNo = calculatePickNumber(tuple.round, originalSlot, teams, isSnake);

      const picksForDraft = draftPicksMap.get(draftInfo.draftId);
      const resolvedPlayerId = picksForDraft?.get(pickNo);
      if (resolvedPlayerId) {
        resolvedPlayerIds.add(resolvedPlayerId);
        const key = `${tuple.season}:${tuple.round}:${tuple.roster_id}`;
        resolvedPickMap.set(key, { playerId: resolvedPlayerId, playerName: resolvedPlayerId });
      }
    }

    if (resolvedPlayerIds.size > 0) {
      const resolvedPlayers = await db
        .select({ id: schema.players.id, name: schema.players.name })
        .from(schema.players)
        .where(inArray(schema.players.id, Array.from(resolvedPlayerIds)));
      const nameMap = new Map(resolvedPlayers.map((p) => [p.id, p.name]));
      for (const [key, val] of resolvedPickMap) {
        const name = nameMap.get(val.playerId);
        if (name) val.playerName = name;
      }
    }
  }

  // Format response
  return rawTransactions.map((tx) => {
    const adds = (tx.adds || {}) as Record<string, number>;
    const drops = (tx.drops || {}) as Record<string, number>;
    const draftPicks = (tx.draftPicks || []) as Array<{
      season: string;
      round: number;
      roster_id: number;
      previous_owner_id: number;
      owner_id: number;
    }>;
    const rosterIds = (tx.rosterIds || []) as number[];
    const rosterMap = rosterOwnerMap.get(tx.leagueId) || new Map();

    return {
      id: tx.id,
      type: tx.type,
      week: tx.week,
      season: leagueSeasonMap.get(tx.leagueId) || "",
      createdAt: tx.createdAt,
      managers: rosterIds.map((rid) => ({
        rosterId: rid,
        name: rosterMap.get(rid) || `Roster ${rid}`,
      })),
      adds: Object.entries(adds).map(([playerId, rosterId]) => ({
        playerId,
        playerName: playerNames.get(playerId) || playerId,
        rosterId,
        managerName: rosterMap.get(rosterId) || `Roster ${rosterId}`,
      })),
      drops: Object.entries(drops).map(([playerId, rosterId]) => ({
        playerId,
        playerName: playerNames.get(playerId) || playerId,
        rosterId,
        managerName: rosterMap.get(rosterId) || `Roster ${rosterId}`,
      })),
      draftPicks: draftPicks.map((dp) => {
        const pickKey = `${dp.season}:${dp.round}:${dp.roster_id}`;
        const resolved = resolvedPickMap.get(pickKey);
        const draft = seasonToDraft.get(dp.season);
        const draftLeagueRosterMap = draft ? rosterOwnerMap.get(draft.leagueId) : undefined;
        const originalOwnerName = draftLeagueRosterMap?.get(dp.roster_id) || null;
        return {
          season: dp.season,
          round: dp.round,
          originalRosterId: dp.roster_id,
          originalOwnerName,
          fromRosterId: dp.previous_owner_id,
          toRosterId: dp.owner_id,
          from: rosterMap.get(dp.previous_owner_id) || `Roster ${dp.previous_owner_id}`,
          to: rosterMap.get(dp.owner_id) || `Roster ${dp.owner_id}`,
          ...(resolved ? { resolvedPlayerId: resolved.playerId, resolvedPlayerName: resolved.playerName } : {}),
        };
      }),
      settings: tx.settings as Record<string, unknown> | null,
      ...(tx.type === "trade" && tradeGradesMap.has(tx.id)
        ? { grades: tradeGradesMap.get(tx.id) }
        : {}),
    };
  });
}
