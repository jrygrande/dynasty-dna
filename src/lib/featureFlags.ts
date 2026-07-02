/**
 * Minimal feature flags: static on/off gates for features in development.
 *
 * This is deliberately NOT an experimentation system. Dynasty DNA doesn't
 * have the traffic for meaningful A/B tests — algorithm decisions are made
 * with offline evals (see /experiments and scripts/experiments/), and
 * feature launches are gated by explicit promotion criteria (see
 * docs/experiments/asset-graph-browser.md for the pattern).
 */

export type FlagStatus = "enabled" | "disabled";

export interface FeatureFlag {
  id: string;
  title: string;
  description: string;
  status: FlagStatus;
}

/**
 * CONVENTION: Callers pass the OBJECT KEY of the FLAGS map (e.g.,
 * "ASSET_GRAPH_BROWSER"), not the `flag.id` field. The `FlagKey` type
 * keeps calls type-safe.
 */
export const FLAGS = {
  MANAGER_DNA_PROFILE: {
    id: "manager-dna-profile",
    title: "Manager DNA Profile",
    description: "Manager Process Score (MPS) combining draft, trade, waiver, and lineup grades",
    status: "disabled",
  },
  ASSET_GRAPH_BROWSER: {
    id: "asset-graph-browser",
    title: "Lineage Tracer",
    description: "Interactive visualization of how players and picks flow between managers",
    status: "enabled",
  },
} satisfies Record<string, FeatureFlag>;

export type FlagKey = keyof typeof FLAGS;

/** Check whether a feature flag is enabled. */
export function isEnabled(flagKey: FlagKey): boolean {
  return FLAGS[flagKey].status === "enabled";
}

/** Get all flags (for debugging / admin views) */
export function getAllFlags(): FeatureFlag[] {
  return Object.values(FLAGS);
}
