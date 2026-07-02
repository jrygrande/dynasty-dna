"use client";

import { useEffect, useState, useMemo } from "react";
import { formatDate } from "@/lib/utils";
import { EVAL_NOTES, type EvalNote, type EvalOutcome } from "./evalNotes";

// ============================================================
// Types
// ============================================================

interface ScorecardMetric {
  name: string;
  value: number;
  baseline?: number;
  lift?: number;
  unit: string;
  direction: "higher" | "lower";
}

interface Scorecard {
  primaryMetrics: ScorecardMetric[];
  secondaryMetrics?: ScorecardMetric[];
  guardrailMetrics?: ScorecardMetric[];
}

interface ExperimentRun {
  id: string;
  name: string;
  hypothesis: string | null;
  acceptanceCriteria: string | null;
  verdict: string | null;
  verdictReason: string | null;
  scorecard: Scorecard | null;
  config: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  familyId: string | null;
  status: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

// ============================================================
// Utilities
// ============================================================

function formatName(slug: string): string {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bPar\b/i, "PAR")
    .replace(/\bMos\b/i, "MOS")
    .replace(/\bVs\b/i, "vs")
    .replace(/\bPpg\b/i, "PPG");
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "running...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatLift(lift: number): string {
  const pct = Math.round(lift * 100);
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}%`;
}

// ============================================================
// Verdict block
// ============================================================

const VERDICT_STYLES: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  confirmed: {
    bg: "bg-grade-a/8",
    border: "border-grade-a/25",
    text: "text-grade-a",
    dot: "bg-grade-a",
  },
  rejected: {
    bg: "bg-grade-f/8",
    border: "border-grade-f/25",
    text: "text-grade-f",
    dot: "bg-grade-f",
  },
  inconclusive: {
    bg: "bg-grade-c/8",
    border: "border-grade-c/25",
    text: "text-grade-c",
    dot: "bg-grade-c",
  },
};

function VerdictBlock({ verdict, reason }: { verdict: string | null; reason: string | null }) {
  const style = VERDICT_STYLES[verdict ?? ""] ?? {
    bg: "bg-muted/50",
    border: "border-border",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
  };

  return (
    <div className={`rounded-lg border p-4 ${style.bg} ${style.border}`}>
      <div className="flex items-center gap-2.5">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${style.dot}`} />
        <span className={`text-sm font-semibold uppercase tracking-wider ${style.text}`}>
          {verdict ?? "Pending"}
        </span>
      </div>
      {reason && (
        <p className={`mt-1.5 text-sm ${style.text} opacity-80`}>{reason}</p>
      )}
    </div>
  );
}

// ============================================================
// Decision block — what happened in production as a result
// ============================================================

const OUTCOME_LABELS: Record<EvalOutcome, string> = {
  shipped: "Shipped",
  "kept-baseline": "Kept baseline",
  rejected: "Rejected — not shipped",
};

const OUTCOME_STYLES: Record<EvalOutcome, string> = {
  shipped: "bg-grade-a/8 text-grade-a border-grade-a/25",
  "kept-baseline": "bg-grade-b/8 text-grade-b border-grade-b/25",
  rejected: "bg-muted text-muted-foreground border-border",
};

function DecisionBlock({ note }: { note: EvalNote }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        Decision
      </h4>
      <div className="rounded-lg border border-border p-4 space-y-2">
        <span
          className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-mono uppercase tracking-wide ${OUTCOME_STYLES[note.outcome]}`}
        >
          {OUTCOME_LABELS[note.outcome]}
        </span>
        <p className="text-sm leading-relaxed">{note.decision}</p>
        {note.shippedRef && (
          <p className="text-xs font-mono text-muted-foreground">{note.shippedRef}</p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Scorecard components
// ============================================================

function LiftCell({ metric }: { metric: ScorecardMetric }) {
  if (metric.lift === undefined || metric.baseline === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }

  const isPositive = metric.lift > 0;
  const isGood =
    (metric.direction === "higher" && isPositive) ||
    (metric.direction === "lower" && !isPositive);
  const arrow = isPositive ? "▲" : metric.lift < 0 ? "▼" : "—";
  const color = metric.lift === 0
    ? "text-muted-foreground"
    : isGood
      ? "text-grade-a"
      : "text-grade-f";

  return (
    <span className={`font-mono font-medium ${color}`}>
      {arrow} {formatLift(metric.lift)}
    </span>
  );
}

function ScorecardTable({
  metrics,
  label,
  variant,
}: {
  metrics: ScorecardMetric[];
  label: string;
  variant: "primary" | "secondary" | "guardrail";
}) {
  if (metrics.length === 0) return null;

  const hasBaseline = metrics.some((m) => m.baseline !== undefined);
  const hasLift = metrics.some((m) => m.lift !== undefined);

  const headerColor =
    variant === "primary"
      ? "text-foreground"
      : variant === "guardrail"
        ? "text-grade-c"
        : "text-muted-foreground";

  return (
    <div>
      <h4
        className={`text-[11px] font-semibold uppercase tracking-widest mb-2 ${headerColor}`}
      >
        {label}
      </h4>
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40">
              <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">
                Metric
              </th>
              <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                Value
              </th>
              {hasBaseline && (
                <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                  Baseline
                </th>
              )}
              {hasLift && (
                <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                  Lift
                </th>
              )}
              <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground w-20">
                Unit
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.name} className="border-t border-muted/30">
                <td className="py-2.5 px-3 font-medium">{m.name}</td>
                <td className="py-2.5 px-3 text-right font-mono">
                  {typeof m.value === "number" && m.value % 1 !== 0
                    ? m.value.toFixed(3)
                    : m.value}
                </td>
                {hasBaseline && (
                  <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">
                    {m.baseline !== undefined
                      ? typeof m.baseline === "number" && m.baseline % 1 !== 0
                        ? m.baseline.toFixed(3)
                        : m.baseline
                      : "—"}
                  </td>
                )}
                {hasLift && (
                  <td className="py-2.5 px-3 text-right">
                    <LiftCell metric={m} />
                  </td>
                )}
                <td className="py-2.5 px-3 text-right text-xs text-muted-foreground">
                  {m.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScorecardSection({ scorecard }: { scorecard: Scorecard }) {
  return (
    <div className="space-y-4">
      <ScorecardTable
        metrics={scorecard.primaryMetrics}
        label="Primary Metrics"
        variant="primary"
      />
      {scorecard.secondaryMetrics && scorecard.secondaryMetrics.length > 0 && (
        <ScorecardTable
          metrics={scorecard.secondaryMetrics}
          label="Secondary Metrics"
          variant="secondary"
        />
      )}
      {scorecard.guardrailMetrics && scorecard.guardrailMetrics.length > 0 && (
        <ScorecardTable
          metrics={scorecard.guardrailMetrics}
          label="Guardrail Metrics"
          variant="guardrail"
        />
      )}
    </div>
  );
}

// ============================================================
// Eval card
// ============================================================

function EvalCard({ run, note }: { run: ExperimentRun; note?: EvalNote }) {
  const [showDetails, setShowDetails] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  return (
    <div className="border rounded-lg bg-card">
      <div className="p-5 space-y-4">
        {note && (
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              The Question
            </h4>
            <p className="text-sm leading-relaxed">{note.question}</p>
          </div>
        )}

        {run.hypothesis && (
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Hypothesis
            </h4>
            <p className="text-sm leading-relaxed">{run.hypothesis}</p>
          </div>
        )}

        {run.acceptanceCriteria && (
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Acceptance Criteria{" "}
              <span className="normal-case tracking-normal font-normal">
                (set before the run)
              </span>
            </h4>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {run.acceptanceCriteria}
            </p>
          </div>
        )}

        <VerdictBlock verdict={run.verdict} reason={run.verdictReason} />

        {note && <DecisionBlock note={note} />}

        {run.scorecard && run.scorecard.primaryMetrics.length > 0 && (
          <ScorecardSection scorecard={run.scorecard} />
        )}

        {run.error && (
          <div className="p-3 bg-grade-f/8 rounded-md text-sm text-grade-f border border-grade-f/25">
            {run.error}
          </div>
        )}
      </div>

      <div className="border-t px-5 py-3 bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className={`inline-flex items-center gap-1 ${run.status === "success" ? "text-grade-a" : run.status === "failed" ? "text-grade-f" : "text-grade-b"}`}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
              {run.status}
            </span>
            <span>{formatDate(run.startedAt)}</span>
            <span>{formatDuration(run.startedAt, run.finishedAt)}</span>
          </div>
          <div className="flex items-center gap-3">
            {run.metrics && Object.keys(run.metrics).length > 0 && (
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showDetails ? "Hide" : "Show"} full metrics
              </button>
            )}
            <button
              onClick={() => setShowRawJson(!showRawJson)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showRawJson ? "Hide" : "Show"} JSON
            </button>
          </div>
        </div>

        {showDetails && run.metrics && (
          <div className="mt-3 pt-3 border-t border-muted/30">
            <pre className="text-xs bg-muted/50 rounded p-3 overflow-x-auto max-h-96">
              {JSON.stringify(run.metrics, null, 2)}
            </pre>
          </div>
        )}

        {showRawJson && (
          <div className="mt-3 pt-3 border-t border-muted/30">
            <pre className="text-xs bg-muted/50 rounded p-3 overflow-x-auto max-h-96">
              {JSON.stringify(
                {
                  scorecard: run.scorecard,
                  metrics: run.metrics,
                  config: run.config,
                },
                null,
                2,
              )}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// How it works
// ============================================================

const PIPELINE_STEPS: { label: string; detail: string }[] = [
  {
    label: "Pre-register",
    detail: "Hypothesis and acceptance criteria are committed before the eval runs — no moving the goalposts after seeing the numbers.",
  },
  {
    label: "Replay history",
    detail: "The candidate algorithm is scored against complete league history. Every run is persisted with its config and git hash.",
  },
  {
    label: "Score the verdict",
    detail: "The result is judged against the pre-registered criteria: confirmed, rejected, or inconclusive.",
  },
  {
    label: "Decide & ship",
    detail: "Winners are promoted into the production algorithm config; losers are rejected and documented. Every verdict has a consequence.",
  },
];

function HowItWorks() {
  return (
    <div className="mb-10 grid gap-3 sm:grid-cols-2">
      {PIPELINE_STEPS.map((step, i) => (
        <div key={step.label} className="border rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-xs text-primary">{i + 1}</span>
            <h3 className="text-sm font-semibold">{step.label}</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {step.detail}
          </p>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Page
// ============================================================

export default function EvalsPage() {
  const [runs, setRuns] = useState<ExperimentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/experiments")
      .then((res) => res.json())
      .then((data) => {
        setRuns(data.runs || []);
        if (data.error) setError(data.error);
      })
      .catch(() => setError("Failed to load evals."))
      .finally(() => setLoading(false));
  }, []);

  // Group by eval name, show only the most recent run per eval,
  // ordered by the editorial sequence in EVAL_NOTES (unknown names last).
  const { evals, runCounts } = useMemo(() => {
    const latestByName = new Map<string, ExperimentRun>();
    const counts = new Map<string, number>();
    for (const run of runs) {
      counts.set(run.name, (counts.get(run.name) ?? 0) + 1);
      const existing = latestByName.get(run.name);
      if (!existing || new Date(run.startedAt) > new Date(existing.startedAt)) {
        latestByName.set(run.name, run);
      }
    }
    const ordered = Array.from(latestByName.values()).sort((a, b) => {
      const orderA = EVAL_NOTES[a.name]?.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = EVAL_NOTES[b.name]?.order ?? Number.MAX_SAFE_INTEGER;
      return orderA !== orderB ? orderA - orderB : a.name.localeCompare(b.name);
    });
    return { evals: ordered, runCounts: counts };
  }, [runs]);

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-6 py-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="font-serif text-4xl font-medium tracking-tight">Evals</h1>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed max-w-2xl">
            Every change to the grading engine earns its way into production
            through an offline eval: a pre-registered hypothesis, a replay
            against years of real league history, and a decision. The goal is
            a Manager Process Score (MPS) that actually predicts league
            success — measured as correlation with Manager Outcome Score
            (MOS), the ground-truth composite of wins, starter points, and
            playoff results.
          </p>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed max-w-2xl">
            Fantasy history is a rare luxury: complete data with known
            outcomes. Instead of guessing how an algorithm change will
            perform, every variant is replayed against years of real seasons
            and scored on how well it predicts what actually happened —
            before it touches a single grade in production.
          </p>
        </div>

        <HowItWorks />

        {loading && (
          <div className="text-center py-12 text-muted-foreground">
            Loading evals...
          </div>
        )}

        {error && (
          <div className="p-4 bg-grade-f/8 rounded-lg text-sm text-grade-f border border-grade-f/25 mb-6">
            {error}
          </div>
        )}

        {!loading && evals.length === 0 && !error && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No evals have been run yet.</p>
          </div>
        )}

        <div className="space-y-8">
          {evals.map((run) => {
            const note = EVAL_NOTES[run.name];
            const totalRuns = runCounts.get(run.name) ?? 1;
            return (
              <div key={run.name}>
                <div className="flex items-baseline gap-2 mb-3">
                  <h2 className="text-lg font-semibold">
                    {note?.title ?? formatName(run.name)}
                  </h2>
                  {totalRuns > 1 && (
                    <span className="text-xs text-muted-foreground">
                      (latest of {totalRuns} runs)
                    </span>
                  )}
                </div>
                <EvalCard run={run} note={note} />
              </div>
            );
          })}
        </div>

        {!loading && evals.length > 0 && (
          <footer className="mt-12 pt-6 border-t space-y-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground/70">Method notes:</span>{" "}
              predictiveness is measured with Spearman rank correlation against
              MOS. Samples are league-seasons, not users — small by design, so
              lifts are treated as directional evidence and weighed alongside
              manual review of extreme cases, not read as significance tests.
            </p>
            <p className="text-xs text-muted-foreground">
              The eval harness, per-eval scripts, and full methodology are open source:{" "}
              <a
                href="https://github.com/jrygrande/dynasty-dna/tree/main/scripts/experiments"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                scripts/experiments on GitHub
              </a>
            </p>
          </footer>
        )}
      </main>
    </div>
  );
}
