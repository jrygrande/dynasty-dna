"use client";

import { isEnabled, type FlagKey } from "./featureFlags";

export function useFlag(flagKey: FlagKey): boolean {
  return isEnabled(flagKey);
}
