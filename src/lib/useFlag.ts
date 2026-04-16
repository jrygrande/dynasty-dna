"use client";

import { useSession } from "next-auth/react";
import { isEnabled, type FlagKey } from "./featureFlags";

/**
 * Client-side feature flag hook. Pass the FLAGS object key (e.g., "ASSET_GRAPH_BROWSER").
 * Returns false for unknown keys or when isEnabled() returns false for the current user.
 */
export function useFlag(flagKey: FlagKey): boolean {
  const { data } = useSession();
  return isEnabled(flagKey, data?.user.id);
}
