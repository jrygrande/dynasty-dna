import { getDb, getSyncDb, schema } from "@/db";
import { eq, and } from "drizzle-orm";
import { BATCH_SIZE } from "@/services/batchHelper";

type NewAssetEvent = typeof schema.assetEvents.$inferInsert;

/**
 * Build a rosterId → ownerId (Sleeper user_id) map for a league.
 */
async function getRosterOwnerMap(
  leagueId: string
): Promise<Map<number, string>> {
  const db = getDb();
  const rosters = await db
    .select({ rosterId: schema.rosters.rosterId, ownerId: schema.rosters.ownerId })
    .from(schema.rosters)
    .where(eq(schema.rosters.leagueId, leagueId));

  const map = new Map<number, string>();
  for (const r of rosters) {
    if (r.ownerId) map.set(r.rosterId, r.ownerId);
  }
  return map;
}

/**
 * Build asset events for a single league season.
 * Uses delete-and-rebuild pattern for idempotency.
 */
export async function buildAssetEvents(
  leagueId: string,
  season: string
): Promise<number> {
  const db = getDb();
  const syncDb = getSyncDb();
  const ownerMap = await getRosterOwnerMap(leagueId);

  const events: NewAssetEvent[] = [];

  // 1. Process transactions → trade, waiver, free_agent events
  const transactions = await db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.leagueId, leagueId));

  for (const tx of transactions) {
    const adds = (tx.adds || {}) as Record<string, number>;
    const drops = (tx.drops || {}) as Record<string, number>;

    if (tx.type === "trade") {
      // Player adds in trades
      for (const [playerId, toRosterId] of Object.entries(adds)) {
        // Find who dropped this player (the other side of the trade)
        const fromRosterId = drops[playerId];
        events.push({
          leagueId,
          season,
          week: tx.week,
          eventType: "trade",
          assetKind: "player",
          playerId,
          fromRosterId: fromRosterId ?? null,
          toRosterId: Number(toRosterId),
          fromUserId: fromRosterId ? ownerMap.get(fromRosterId) ?? null : null,
          toUserId: ownerMap.get(Number(toRosterId)) ?? null,
          transactionId: tx.id,
          createdAt: tx.createdAt,
        });
      }

      // Player drops that weren't also adds (players cut as part of trade)
      for (const [playerId, fromRosterId] of Object.entries(drops)) {
        if (adds[playerId] !== undefined) continue; // Already handled above
        events.push({
          leagueId,
          season,
          week: tx.week,
          eventType: "trade",
          assetKind: "player",
          playerId,
          fromRosterId: Number(fromRosterId),
          toRosterId: null,
          fromUserId: ownerMap.get(Number(fromRosterId)) ?? null,
          toUserId: null,
          transactionId: tx.id,
          createdAt: tx.createdAt,
        });
      }

      // Draft pick trades
      const tradedPicks = (tx.draftPicks || []) as Array<{
        season: string;
        round: number;
        roster_id: number;
        previous_owner_id: number;
        owner_id: number;
      }>;

      for (const pick of tradedPicks) {
        events.push({
          leagueId,
          season,
          week: tx.week,
          eventType: "pick_trade",
          assetKind: "pick",
          pickSeason: pick.season,
          pickRound: pick.round,
          pickOriginalRosterId: pick.roster_id,
          fromRosterId: pick.previous_owner_id,
          toRosterId: pick.owner_id,
          fromUserId: ownerMap.get(pick.previous_owner_id) ?? null,
          toUserId: ownerMap.get(pick.owner_id) ?? null,
          transactionId: tx.id,
          createdAt: tx.createdAt,
        });
      }
    } else if (tx.type === "waiver") {
      for (const [playerId, toRosterId] of Object.entries(adds)) {
        events.push({
          leagueId,
          season,
          week: tx.week,
          eventType: "waiver_add",
          assetKind: "player",
          playerId,
          fromRosterId: null,
          toRosterId: Number(toRosterId),
          fromUserId: null,
          toUserId: ownerMap.get(Number(toRosterId)) ?? null,
          transactionId: tx.id,
          details: tx.settings, // Contains waiver bid amount
          createdAt: tx.createdAt,
        });
      }
      for (const [playerId, fromRosterId] of Object.entries(drops)) {
        events.push({
          leagueId,
          season,
          week: tx.week,
          eventType: "waiver_drop",
          assetKind: "player",
          playerId,
          fromRosterId: Number(fromRosterId),
          toRosterId: null,
          fromUserId: ownerMap.get(Number(fromRosterId)) ?? null,
          toUserId: null,
          transactionId: tx.id,
          createdAt: tx.createdAt,
        });
      }
    } else if (tx.type === "free_agent") {
      for (const [playerId, toRosterId] of Object.entries(adds)) {
        events.push({
          leagueId,
          season,
          week: tx.week,
          eventType: "free_agent_add",
          assetKind: "player",
          playerId,
          fromRosterId: null,
          toRosterId: Number(toRosterId),
          fromUserId: null,
          toUserId: ownerMap.get(Number(toRosterId)) ?? null,
          transactionId: tx.id,
          createdAt: tx.createdAt,
        });
      }
      for (const [playerId, fromRosterId] of Object.entries(drops)) {
        events.push({
          leagueId,
          season,
          week: tx.week,
          eventType: "free_agent_drop",
          assetKind: "player",
          playerId,
          fromRosterId: Number(fromRosterId),
          toRosterId: null,
          fromUserId: ownerMap.get(Number(fromRosterId)) ?? null,
          toUserId: null,
          transactionId: tx.id,
          createdAt: tx.createdAt,
        });
      }
    }
  }

  // 2. Process draft picks → draft_selected events
  const drafts = await db
    .select()
    .from(schema.drafts)
    .where(eq(schema.drafts.leagueId, leagueId));

  for (const draft of drafts) {
    if (draft.status !== "complete") continue;

    const picks = await db
      .select()
      .from(schema.draftPicks)
      .where(eq(schema.draftPicks.draftId, draft.id));

    for (const pick of picks) {
      if (!pick.playerId) continue;
      events.push({
        leagueId,
        season: draft.season,
        week: 0, // Drafts happen pre-season
        eventType: "draft_selected",
        assetKind: "player",
        playerId: pick.playerId,
        pickSeason: draft.season,
        pickRound: pick.round,
        pickOriginalRosterId: pick.rosterId,
        fromRosterId: null,
        toRosterId: pick.rosterId,
        fromUserId: null,
        toUserId: ownerMap.get(pick.rosterId) ?? null,
        transactionId: null,
        details: {
          pickNo: pick.pickNo,
          round: pick.round,
          isKeeper: pick.isKeeper,
          draftId: draft.id,
        },
        createdAt: draft.startTime ?? null,
      });
    }
  }

  // Atomic delete + batch insert inside a transaction
  await syncDb.transaction(async (tx) => {
    await tx
      .delete(schema.assetEvents)
      .where(
        and(
          eq(schema.assetEvents.leagueId, leagueId),
          eq(schema.assetEvents.season, season)
        )
      );

    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);
      await tx.insert(schema.assetEvents).values(batch);
    }
  });

  return events.length;
}
