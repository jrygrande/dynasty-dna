"use client";

import { useEffect, useMemo, useState } from "react";
import { RoadmapCard } from "@/components/RoadmapCard";
import type { RoadmapIssue } from "@/app/api/roadmap/route";
import { type FeatureFlag, getActiveExperiments } from "@/lib/featureFlags";

const experiments = getActiveExperiments();

type FilterTab = "now" | "next" | "later" | "shipped" | "all";

const PHASE_NAMES: Record<number, string> = {
  1: "Foundation",
  2: "Data Foundation",
  3: "NFL Data & Player Insights",
  4: "Grading Engine",
  5: "Manager Analytics",
  6: "Exploration & Polish",
};

function filterItems(items: RoadmapIssue[], tab: FilterTab): RoadmapIssue[] {
  switch (tab) {
    case "now":
      return items.filter((i) => i.status === "in-progress");
    case "next":
      return items.filter(
        (i) =>
          i.status === "planned" && (i.priority === "p0" || i.priority === "p1")
      );
    case "later":
      return items.filter(
        (i) =>
          i.status === "exploring" ||
          (i.status === "planned" && i.priority === "p2")
      );
    case "shipped":
      return items.filter((i) => i.status === "shipped");
    case "all":
    default:
      return items;
  }
}

function groupByPhase(
  items: RoadmapIssue[]
): { phase: number; name: string; items: RoadmapIssue[] }[] {
  const groups = new Map<number, RoadmapIssue[]>();

  for (const item of items) {
    const phase = item.phase ?? 0;
    if (!groups.has(phase)) groups.set(phase, []);
    groups.get(phase)!.push(item);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([phase, items]) => ({
      phase,
      name: PHASE_NAMES[phase] || "Other",
      items,
    }));
}

function ExperimentCard({ flag }: { flag: FeatureFlag }) {
  return (
    <div className="border border-dashed border-purple-300 dark:border-purple-700 rounded-lg p-4 bg-purple-50/50 dark:bg-purple-950/20">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold">{flag.title}</h3>
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 whitespace-nowrap">
          {flag.rolloutPercent}% rollout
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{flag.description}</p>
      {flag.hypothesis && (
        <p className="text-xs text-muted-foreground mb-2">
          <span className="font-medium text-foreground/70">Hypothesis:</span>{" "}
          {flag.hypothesis}
        </p>
      )}
      {flag.metrics && flag.metrics.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            Measuring:
          </span>
          {flag.metrics.map((m, i) => (
            <span key={i} className="text-[11px] text-muted-foreground">
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RoadmapPage() {
  const [items, setItems] = useState<RoadmapIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  useEffect(() => {
    fetch("/api/roadmap")
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || []);
        if (data.error) setError(data.error);
      })
      .catch(() => setError("Failed to load roadmap."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filterItems(items, activeTab);
  const grouped = groupByPhase(filtered);

  const tabs = useMemo((): { key: FilterTab; label: string; count: number }[] => [
    { key: "all", label: "All", count: items.length },
    { key: "now", label: "Now", count: filterItems(items, "now").length },
    { key: "next", label: "Next", count: filterItems(items, "next").length },
    { key: "later", label: "Later", count: filterItems(items, "later").length },
    { key: "shipped", label: "Shipped", count: filterItems(items, "shipped").length },
  ], [items]);

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-6 py-12 max-w-3xl">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Roadmap</h1>
          <p className="text-muted-foreground">
            How we think about building Dynasty DNA. Every feature starts with a
            hypothesis and measurable success criteria.
          </p>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-8 p-1 bg-muted/50 rounded-lg w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                activeTab === tab.key
                  ? "bg-background text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="text-center py-16">
            <div className="animate-pulse text-muted-foreground">
              Loading roadmap...
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !loading && items.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground mb-4">{error}</p>
            <a
              href="https://github.com/jrygrande/dynasty-dna/issues?q=label%3Aroadmap"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              View roadmap on GitHub →
            </a>
          </div>
        )}

        {/* Roadmap items grouped by phase */}
        {!loading && grouped.length > 0 && (
          <div className="space-y-10">
            {grouped.map((group) => (
              <section key={group.phase}>
                <div className="flex items-center gap-3 mb-4">
                  {group.phase > 0 && (
                    <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      Phase {group.phase}
                    </span>
                  )}
                  <h2 className="text-lg font-semibold">{group.name}</h2>
                  <span className="text-xs text-muted-foreground">
                    {group.items.filter((i) => i.status === "shipped").length}/
                    {group.items.length} shipped
                  </span>
                </div>
                <div className="space-y-3">
                  {group.items.map((item) => (
                    <RoadmapCard key={item.id} issue={item} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && items.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground mb-2">
              No roadmap items yet.
            </p>
            <p className="text-sm text-muted-foreground">
              Check back soon, or{" "}
              <a
                href="https://github.com/jrygrande/dynasty-dna/issues/new/choose"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                submit a feature request
              </a>
              .
            </p>
          </div>
        )}

        {/* Active Experiments section */}
        {experiments.length > 0 && (
          <section className="mt-12">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-lg font-semibold">Active Experiments</h2>
              <span className="text-xs text-muted-foreground">
                Testing hypotheses with real users
              </span>
            </div>
            <div className="space-y-3">
              {experiments.map((flag) => (
                <ExperimentCard key={flag.id} flag={flag} />
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-muted-foreground">
            <p>
              Built with hypothesis-driven development.{" "}
              <a
                href="https://github.com/jrygrande/dynasty-dna"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                View source on GitHub
              </a>
            </p>
            <a
              href="https://github.com/jrygrande/dynasty-dna/issues/new/choose"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Submit a feature request →
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
