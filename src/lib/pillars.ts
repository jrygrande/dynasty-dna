export const PILLAR_KEYS = [
  "trade_score",
  "draft_score",
  "waiver_score",
  "lineup_score",
] as const;

export type PillarKey = (typeof PILLAR_KEYS)[number];

export const PILLAR_LABELS: Record<PillarKey, string> = {
  trade_score: "Trading",
  draft_score: "Drafting",
  waiver_score: "Waivers",
  lineup_score: "Lineups",
};
