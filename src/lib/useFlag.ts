"use client";

import { isEnabled, type FlagKey } from "./featureFlags";

// TODO #84: PostHog flag SDK — replace this stub with anonymous-distinct-id
// bucketing once the PostHog client is wired up.
export function useFlag(flagKey: FlagKey): boolean {
  return isEnabled(flagKey);
}
