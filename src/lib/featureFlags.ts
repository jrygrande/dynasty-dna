/**
 * Lightweight feature flags with experiment support.
 *
 * Each flag has a hypothesis and metrics — making experimentation
 * thinking visible in the codebase itself. Active experiments are
 * surfaced on the public /roadmap page.
 */

export type FlagStatus = "enabled" | "disabled" | "experiment";

export interface FeatureFlag {
  id: string;
  title: string;
  description: string;
  status: FlagStatus;
  /** For experiments: percentage of users who see the treatment (0-100) */
  rolloutPercent?: number;
  /** What we believe will happen */
  hypothesis?: string;
  /** How we'll measure success */
  metrics?: string[];
  /** Link to the GitHub Issue for this experiment */
  issueUrl?: string;
}

export const FLAGS: Record<string, FeatureFlag> = {
  TRADE_COUNTERFACTUAL: {
    id: "trade-counterfactual",
    title: "Trade Counterfactual Analysis",
    description: "Show 'what if you hadn't made this trade' scenarios on trade detail pages",
    status: "experiment",
    rolloutPercent: 50,
    hypothesis:
      "Counterfactual analysis makes trade grades more actionable — managers who see what would have happened will engage more deeply with trade history",
    metrics: [
      "Click-through rate on trade detail pages",
      "Time spent on trade analysis views",
    ],
  },
  MANAGER_DNA_PROFILE: {
    id: "manager-dna-profile",
    title: "Manager DNA Profile",
    description: "Composite DNA score combining draft, trade, and lineup grades",
    status: "disabled",
    hypothesis:
      "A single composite score increases engagement with individual analytics features by giving managers a 'headline number' to improve",
    metrics: [
      "Weekly return rate to manager profile",
      "Cross-feature navigation (lineup -> trades -> drafts)",
    ],
  },
  ASSET_GRAPH_BROWSER: {
    id: "asset-graph-browser",
    title: "Asset Graph Browser",
    description: "Interactive visualization of how players and picks flow between managers",
    status: "disabled",
    hypothesis:
      "Visualizing the network of trades as a graph will surface non-obvious patterns that managers find more insightful than a transaction log",
    metrics: [
      "Discovery of multi-hop trade chains",
      "Share rate of graph visualizations",
    ],
  },
} as const;

/**
 * Deterministic hash for consistent user bucketing.
 * Same user always gets the same variant for a given flag.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Check if a feature flag is enabled for a given user.
 *
 * - "enabled" flags are always on
 * - "disabled" flags are always off
 * - "experiment" flags use deterministic bucketing based on userId
 */
export function isEnabled(flagId: string, userId?: string): boolean {
  const flag = FLAGS[flagId];
  if (!flag) return false;
  if (flag.status === "enabled") return true;
  if (flag.status === "disabled") return false;

  if (flag.status === "experiment" && flag.rolloutPercent && userId) {
    const hash = simpleHash(userId + flag.id);
    return hash % 100 < flag.rolloutPercent;
  }

  return false;
}

/** Get all flags with experiment status (for the public /roadmap page) */
export function getActiveExperiments(): FeatureFlag[] {
  return Object.values(FLAGS).filter((f) => f.status === "experiment");
}

/** Get all flags (for debugging / admin views) */
export function getAllFlags(): FeatureFlag[] {
  return Object.values(FLAGS);
}
