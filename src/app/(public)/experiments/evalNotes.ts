/**
 * Editorial layer for the /experiments (Evals) page.
 *
 * Each entry closes the loop between an eval run (persisted to
 * `experiment_runs` by scripts/experiments/*) and the production decision
 * it drove. The DB rows carry the hypothesis, verdict, and scorecard; this
 * file carries the narrative: the product question, the decision made, and
 * where that decision lives in shipped code.
 *
 * Keyed by the eval's `name` as passed to runExperiment(). Every claim in
 * a `decision` must be verifiable in the referenced source file — if the
 * production code changes, update the entry.
 */

export type EvalOutcome = "shipped" | "kept-baseline" | "rejected" | "follow-up";

export interface EvalNote {
  /** Display order on the page (ascending) */
  order: number;
  /** Display title (overrides slug-derived name) */
  title: string;
  /** The product question this eval was designed to answer */
  question: string;
  /** What we decided and did as a result */
  decision: string;
  outcome: EvalOutcome;
  /** Where the decision lives in production code */
  shippedRef?: string;
  /** GitHub issue tracking a follow-up eval, when outcome is "follow-up" */
  issueUrl?: string;
}

export const EVAL_NOTES: Record<string, EvalNote> = {
  "par-vs-rank": {
    order: 1,
    title: "PAR vs Rank-Based Production",
    question:
      "How should we score a player's production — points above a positional replacement level (PAR), or an exponential decay on positional rank? Rank decay treats WR13 and WR30 as meaningfully different even when their per-game output is nearly identical.",
    decision:
      "Follow-up open. PAR is in production, but this run's criterion failed — a redesigned eval (roster-outcome correlation, small-sample fix) either passes or PAR reverts to rank decay.",
    outcome: "follow-up",
    shippedRef: "src/services/gradingCore.ts · playerSeasonalPAR()",
    issueUrl: "https://github.com/jrygrande/dynasty-dna/issues/188",
  },
  "blend-sensitivity": {
    order: 2,
    title: "Blend Curve Sensitivity",
    question:
      "Grades blend market value with realized production over time. Should one universal ramp curve govern all transaction types, or do trades, drafts, and waivers each deserve their own? A rookie pick shouldn't be judged on production after 8 weeks; a waiver add should.",
    decision:
      "Follow-up open. Per-pillar curves are in production, but the trade curve failed its calibration check — a slower ramp won one horizon bucket outright, so the follow-up tunes the curve until it beats the universal ramp or reverts the trade pillar.",
    outcome: "follow-up",
    shippedRef: "src/services/algorithmConfig.ts · DEFAULT_CONFIG.blendProfiles",
    issueUrl: "https://github.com/jrygrande/dynasty-dna/issues/189",
  },
  "production-layer-ablation": {
    order: 3,
    title: "Production Layer Ablation",
    question:
      "Does weighting production by context — did the player actually start, did the matchup swing on him, was it the playoffs — track season outcomes better than raw PAR? An ablation across four configurations isolates what each layer contributes.",
    decision:
      "Shipped. The full layered stack (starter × matchup × playoff multipliers) is how production is computed inside every ownership window.",
    outcome: "shipped",
    shippedRef:
      "src/services/gradingCore.ts · starterMultiplier / matchupOutcomeMultiplier / playoffWeightMultiplier",
  },
  "roster-scoped-vs-unbounded": {
    order: 4,
    title: "Roster-Scoped vs Unbounded Production",
    question:
      "When you trade a player away and he breaks out two seasons later, should that production count in your grade? Unbounded scoring said yes — and produced grades that felt wrong in exactly the cases managers care most about.",
    decision:
      "Shipped. Production is scoped to roster ownership windows — a grade reflects what a player did while you actually held him.",
    outcome: "shipped",
    shippedRef: "src/services/gradingCore.ts · ownership-window production",
  },
  "mos-weight-sensitivity": {
    order: 5,
    title: "MOS Weight Sensitivity",
    question:
      "Manager Outcome Score is the ground truth every other eval correlates against, so its weights have to be defensible. Do the baseline weights (40% starter points, 30% win rate, 20% playoff, 10% championship) discriminate between managers and stay stable season over season?",
    decision:
      "Follow-up open. Baseline kept for now — two different vectors each edged it on a single metric by small margins, so the original criterion can't name one winner. The follow-up reruns with a composite criterion and confidence intervals.",
    outcome: "follow-up",
    shippedRef: "src/services/outcomeScore.ts · DEFAULT_WEIGHTS",
    issueUrl: "https://github.com/jrygrande/dynasty-dna/issues/190",
  },
  "quality-x-quantity-blend": {
    order: 6,
    title: "Quality × Quantity Blend",
    question:
      "Should a manager's pillar score reward average decision quality alone (α = 1.0), or blend in the volume of good decisions? One great trade shouldn't automatically outrank ten good ones.",
    decision:
      "Shipped. Per-pillar α values (trade 0.50, draft 0.60, waiver 0.40) are the production quality weights.",
    outcome: "shipped",
    shippedRef: "src/services/algorithmConfig.ts · DEFAULT_CONFIG.qualityWeights",
  },
  "waiver-grading-validation": {
    order: 7,
    title: "Waiver Grading Validation",
    question:
      "Is waiver activity real signal about manager skill, or noise? Before keeping waiver_score as a pillar of the composite, verify it correlates with outcomes on its own and that a 4-pillar composite out-predicts a 2-pillar one.",
    decision:
      "Kept. Waiver grading carries independent signal and the 4-pillar composite predicts outcomes best — waiver_score remains a full pillar of MPS.",
    outcome: "kept-baseline",
    shippedRef: "src/services/algorithmConfig.ts · DEFAULT_CONFIG.pillarWeights",
  },
  "faab-efficiency-signal": {
    order: 8,
    title: "FAAB Efficiency Signal",
    question:
      "In FAAB leagues, does rewarding bid efficiency — getting value cheaply — add predictive signal on top of raw value scoring, or just noise?",
    decision:
      "Rejected. Stripping the FAAB bonus predicted outcomes as well or better, so the bonus was removed from production scoring entirely. A hypothesis we liked, killed by its own scorecard.",
    outcome: "rejected",
    shippedRef: "src/services/algorithmConfig.ts · faabBonusMax = 0",
  },
};
