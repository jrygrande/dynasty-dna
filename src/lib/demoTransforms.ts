import type { DemoMap, DemoUserMapping } from "@/lib/demoAnonymize";
import { lookupSwap } from "@/lib/demoAnonymize";

// Look up the swap for a manager identified by userId and/or rosterId.
function swapFor(
  map: DemoMap,
  userId?: string | null,
  rosterId?: number | null
): DemoUserMapping | undefined {
  return lookupSwap(map, userId, rosterId);
}

// Swap a single league user record. Avatar drops to null so the client's
// existing initial-chip fallback renders the pseudonym's initials.
export function swapLeagueUser<
  U extends {
    userId: string;
    displayName: string | null;
    teamName: string | null;
    avatar: string | null;
  }
>(user: U, map: DemoMap): U {
  const sw = swapFor(map, user.userId);
  if (!sw) return user;
  return {
    ...user,
    displayName: sw.displayName,
    teamName: sw.teamName,
    avatar: null,
  };
}

// Resolve the rendered display name for a roster owner — what the existing
// transactionEnrichment helper bakes into manager/from/to/originalOwnerName
// fields.
export function swapRosterOwnerName(
  map: DemoMap,
  rosterId: number,
  fallback: string
): string {
  return swapFor(map, undefined, rosterId)?.displayName ?? fallback;
}

export function swapUserDisplayName(
  map: DemoMap,
  userId: string | null | undefined,
  fallback: string
): string {
  if (!userId) return fallback;
  return swapFor(map, userId)?.displayName ?? fallback;
}
