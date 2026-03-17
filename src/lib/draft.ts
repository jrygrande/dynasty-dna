/**
 * Shared draft pick resolution utilities.
 * Used by both the trade grading engine and the transactions API.
 */

import { getDb, schema } from "@/db";
import { inArray } from "drizzle-orm";

/**
 * Find the original draft slot for a given roster ID from a slot→rosterId map.
 */
export function findOriginalSlot(
  slotMap: Record<string, number>,
  rosterId: number,
): number | null {
  for (const [slot, rid] of Object.entries(slotMap)) {
    if (rid === rosterId) {
      return parseInt(slot, 10);
    }
  }
  return null;
}

/**
 * Calculate the overall pick number given round, slot, total rosters, and draft type.
 * For snake drafts, even rounds reverse the order.
 */
export function calculatePickNumber(
  round: number,
  originalSlot: number,
  totalRosters: number,
  isSnake: boolean,
): number {
  if (isSnake && round % 2 === 0) {
    return (round - 1) * totalRosters + (totalRosters + 1 - originalSlot);
  }
  return (round - 1) * totalRosters + originalSlot;
}

// ============================================================
// Shared draft pick resolution (loads drafts + picks from DB)
// ============================================================

export interface DraftInfo {
  slotToRosterId: Record<string, number> | null;
  draftId: string;
  status: string;
  type: string;
  totalRosters: number;
}

export interface DraftPickResolutionResult {
  /** season → DraftInfo */
  draftsBySeason: Map<string, DraftInfo>;
  /** draftId → (pickNo → playerId) */
  draftPicksMap: Map<string, Map<number, string>>;
}

/**
 * Load drafts and their picks for a set of league IDs.
 * Optionally filter to specific seasons.
 * Returns maps keyed by season and draftId for pick resolution.
 */
export async function resolveDraftPicks(
  leagueIds: string[],
  opts?: { seasons?: string[] },
): Promise<DraftPickResolutionResult> {
  const db = getDb();

  const draftsBySeason = new Map<string, DraftInfo>();
  const draftPicksMap = new Map<string, Map<number, string>>();

  if (leagueIds.length === 0) return { draftsBySeason, draftPicksMap };

  // Load drafts
  let familyDrafts = await db
    .select({
      id: schema.drafts.id,
      season: schema.drafts.season,
      status: schema.drafts.status,
      type: schema.drafts.type,
      slotToRosterId: schema.drafts.slotToRosterId,
      leagueId: schema.drafts.leagueId,
    })
    .from(schema.drafts)
    .where(inArray(schema.drafts.leagueId, leagueIds));

  // Filter by seasons if specified
  if (opts?.seasons && opts.seasons.length > 0) {
    const seasonSet = new Set(opts.seasons);
    familyDrafts = familyDrafts.filter((d) => seasonSet.has(d.season));
  }

  // Load roster counts for teams
  const leagueRosterCounts = await db
    .select({
      id: schema.leagues.id,
      totalRosters: schema.leagues.totalRosters,
    })
    .from(schema.leagues)
    .where(inArray(schema.leagues.id, leagueIds));

  const rosterCountMap = new Map(
    leagueRosterCounts.map((l) => [l.id, l.totalRosters || 12]),
  );

  for (const d of familyDrafts) {
    draftsBySeason.set(d.season, {
      slotToRosterId: d.slotToRosterId as Record<string, number> | null,
      draftId: d.id,
      status: d.status || "",
      type: d.type || "snake",
      totalRosters: rosterCountMap.get(d.leagueId) || 12,
    });
  }

  const completedDraftIds = familyDrafts
    .filter((d) => d.status === "complete")
    .map((d) => d.id);

  if (completedDraftIds.length > 0) {
    const allPicks = await db
      .select({
        draftId: schema.draftPicks.draftId,
        pickNo: schema.draftPicks.pickNo,
        playerId: schema.draftPicks.playerId,
      })
      .from(schema.draftPicks)
      .where(inArray(schema.draftPicks.draftId, completedDraftIds));

    for (const dp of allPicks) {
      if (!dp.playerId) continue;
      if (!draftPicksMap.has(dp.draftId)) {
        draftPicksMap.set(dp.draftId, new Map());
      }
      draftPicksMap.get(dp.draftId)!.set(dp.pickNo, dp.playerId);
    }
  }

  return { draftsBySeason, draftPicksMap };
}
