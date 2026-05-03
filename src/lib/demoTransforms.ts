import type { DemoMap } from "@/lib/demoAnonymize";
import { lookupSwap } from "@/lib/demoAnonymize";

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
  const sw = lookupSwap(map, user.userId);
  if (!sw) return user;
  return {
    ...user,
    displayName: sw.displayName,
    teamName: sw.teamName,
    avatar: null,
  };
}
