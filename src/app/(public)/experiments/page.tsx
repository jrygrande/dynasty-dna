"use client";

import { useEffect, useState, useMemo } from "react";
import { formatDate } from "@/lib/utils";

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
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    border: "border-emerald-200 dark:border-emerald-800",
    text: "text-emerald-800 dark:text-emerald-200",
    dot: "bg-emerald-500",
  },
  rejected: {
    bg: "bg-red-50 dark:bg-red-950/40",
    border: "border-red-200 dark:border-red-800",
    text: "text-red-800 dark:text-red-200",
    dot: "bg-red-500",
  },
  inconclusive: {
    bg: "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-200 dark:border-amber-800",
    text: "text-amber-800 dark:text-amber-200",
    dot: "bg-amber-500",
  },
};

function VerdictBlock({ verdict, reason }: { verdict: string | null; reason: string | null }) {
  const style = VERDICT_STYLES[verdict ?? ""] ?? {
    bg: "bg-gray-50 dark:bg-gray-900",
    border: "border-gray-200 dark:border-gray-700",
    text: "text-gray-500 dark:text-gray-400",
    dot: "bg-gray-400",
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
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";

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
        ? "text-amber-700 dark:text-amber-400"
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
// Experiment card
// ============================================================

function ExperimentCard({ run }: { run: ExperimentRun }) {
  const [showDetails, setShowDetails] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  return (
    <div className="border rounded-lg bg-card">
      <div className="p-5 space-y-4">
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
              Acceptance Criteria
            </h4>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {run.acceptanceCriteria}
            </p>
          </div>
        )}

        <VerdictBlock verdict={run.verdict} reason={run.verdictReason} />

        {run.scorecard && run.scorecard.primaryMetrics.length > 0 && (
          <ScorecardSection scorecard={run.scorecard} />
        )}

        {run.error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-md text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
            {run.error}
          </div>
        )}
      </div>

      <div className="border-t px-5 py-3 bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className={`inline-flex items-center gap-1 ${run.status === "success" ? "text-emerald-600 dark:text-emerald-400" : run.status === "failed" ? "text-red-600 dark:text-red-400" : "text-blue-600"}`}>
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
// Page
// ============================================================

export default function ExperimentsPage() {
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
      .catch(() => setError("Failed to load experiments."))
      .finally(() => setLoading(false));
  }, []);

  // Group by experiment name, show only the most recent run per experiment
  const { experiments, runCounts } = useMemo(() => {
    const latestByName = new Map<string, ExperimentRun>();
    const counts = new Map<string, number>();
    for (const run of runs) {
      counts.set(run.name, (counts.get(run.name) ?? 0) + 1);
      const existing = latestByName.get(run.name);
      if (!existing || new Date(run.startedAt) > new Date(existing.startedAt)) {
        latestByName.set(run.name, run);
      }
    }
    return {
      experiments: Array.from(latestByName.values()).sort((a, b) => a.name.localeCompare(b.name)),
      runCounts: counts,
    };
  }, [runs]);

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-6 py-8 max-w-3xl">
        <div className="mb-10">
          <h1 className="text-2xl font-bold tracking-tight">Experiments</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed max-w-2xl">
            Experiments tune Manager Process Score (MPS) — our composite
            grading algorithm — to be predictive of actual fantasy league
            success, as measured by Manager Outcome Score (MOS).
          </p>
        </div>

        {loading && (
          <div className="text-center py-12 text-muted-foreground">
            Loading experiments...
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm text-red-700 dark:text-red-300 mb-6">
            {error}
          </div>
        )}

        {!loading && experiments.length === 0 && !error && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No experiments have been run yet.</p>
          </div>
        )}

        <div className="space-y-8">
          {experiments.map((run) => {
            const totalRuns = runCounts.get(run.name) ?? 1;
            return (
              <div key={run.name}>
                <div className="flex items-baseline gap-2 mb-3">
                  <h2 className="text-lg font-semibold">{formatName(run.name)}</h2>
                  {totalRuns > 1 && (
                    <span className="text-xs text-muted-foreground">
                      (latest of {totalRuns} runs)
                    </span>
                  )}
                </div>
                <ExperimentCard run={run} />
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
