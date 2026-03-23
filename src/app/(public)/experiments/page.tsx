"use client";

import { useEffect, useState } from "react";
interface ExperimentRun {
  id: string;
  name: string;
  hypothesis: string | null;
  config: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  familyId: string | null;
  status: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  success:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed:
    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  running:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || "bg-gray-100 text-gray-800"}`}
    >
      {status}
    </span>
  );
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "running...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function MetricsDisplay({
  metrics,
}: {
  metrics: Record<string, unknown>;
}) {
  return (
    <div className="space-y-2">
      {Object.entries(metrics).map(([key, value]) => (
        <div key={key}>
          <span className="text-xs font-medium text-muted-foreground">
            {key}
          </span>
          {typeof value === "object" && value !== null ? (
            <pre className="mt-1 text-xs bg-muted/50 rounded p-2 overflow-x-auto max-h-48">
              {JSON.stringify(value, null, 2)}
            </pre>
          ) : (
            <span className="ml-2 text-sm font-mono">
              {String(value)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function ExperimentCard({ run }: { run: ExperimentRun }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm truncate">
                {run.name}
              </h3>
              <StatusBadge status={run.status} />
            </div>
            {run.hypothesis && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {run.hypothesis}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">
              {formatDate(run.startedAt)}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDuration(run.startedAt, run.finishedAt)}
            </p>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t">
          {run.error && (
            <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-700 dark:text-red-300">
              {run.error}
            </div>
          )}

          {run.metrics &&
            Object.keys(run.metrics).length > 0 && (
              <div className="mt-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Metrics
                </h4>
                <MetricsDisplay metrics={run.metrics} />
              </div>
            )}

          {run.config &&
            Object.keys(run.config).length > 0 && (
              <div className="mt-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Config
                </h4>
                <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto">
                  {JSON.stringify(run.config, null, 2)}
                </pre>
              </div>
            )}

          <div className="mt-3 text-xs text-muted-foreground">
            Run ID: {run.id}
          </div>
        </div>
      )}
    </div>
  );
}

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

  // Group by experiment name
  const grouped = runs.reduce(
    (acc, run) => {
      if (!acc[run.name]) acc[run.name] = [];
      acc[run.name].push(run);
      return acc;
    },
    {} as Record<string, ExperimentRun[]>,
  );

  const experimentNames = Object.keys(grouped).sort();

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">
            Experiments
          </h1>
          <p className="text-muted-foreground mt-1">
            Validation runs comparing grading algorithm variants.
            Each experiment tests a hypothesis against real league
            data and records structured metrics.
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

        {!loading && experimentNames.length === 0 && !error && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              No experiments have been run yet.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Run an experiment with:{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                npx tsx scripts/experiments/01-par-vs-rank.ts
              </code>
            </p>
          </div>
        )}

        {experimentNames.map((name) => (
          <div key={name} className="mb-8">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              {name}
              <span className="text-xs font-normal text-muted-foreground">
                ({grouped[name].length}{" "}
                {grouped[name].length === 1 ? "run" : "runs"})
              </span>
            </h2>
            <div className="space-y-2">
              {grouped[name].map((run) => (
                <ExperimentCard key={run.id} run={run} />
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
