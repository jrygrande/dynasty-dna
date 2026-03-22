"use client";

import { useEffect, useState } from "react";
import { PublicNav } from "@/components/PublicNav";
import { StatusBadge } from "@/components/StatusBadge";
import type { RoadmapIssue } from "@/app/api/roadmap/route";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function groupByMonth(
  items: RoadmapIssue[]
): { month: string; items: RoadmapIssue[] }[] {
  const groups = new Map<string, RoadmapIssue[]>();

  for (const item of items) {
    const date = item.closed_at || item.created_at;
    const monthKey = new Date(date).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
    if (!groups.has(monthKey)) groups.set(monthKey, []);
    groups.get(monthKey)!.push(item);
  }

  return Array.from(groups.entries()).map(([month, items]) => ({
    month,
    items: items.sort(
      (a, b) =>
        new Date(b.closed_at || b.created_at).getTime() -
        new Date(a.closed_at || a.created_at).getTime()
    ),
  }));
}

export default function ChangelogPage() {
  const [items, setItems] = useState<RoadmapIssue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/roadmap")
      .then((r) => r.json())
      .then((data) => {
        const shipped = (data.items || []).filter(
          (i: RoadmapIssue) => i.status === "shipped"
        );
        setItems(shipped);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const grouped = groupByMonth(items);

  return (
    <div className="min-h-screen bg-background">
      <PublicNav />

      <main className="container mx-auto px-6 py-12 max-w-3xl">
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Changelog</h1>
          <p className="text-muted-foreground">
            What we&apos;ve shipped and why. Every feature starts with a
            hypothesis — here&apos;s what made it to production.
          </p>
        </div>

        {loading && (
          <div className="text-center py-16">
            <div className="animate-pulse text-muted-foreground">
              Loading changelog...
            </div>
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground">
              No shipped features yet. Check the{" "}
              <a href="/roadmap" className="text-primary hover:underline">
                roadmap
              </a>{" "}
              to see what&apos;s coming.
            </p>
          </div>
        )}

        {!loading && grouped.length > 0 && (
          <div className="space-y-12">
            {grouped.map((group) => (
              <section key={group.month}>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-6">
                  {group.month}
                </h2>
                <div className="space-y-6">
                  {group.items.map((item) => (
                    <a
                      key={item.id}
                      href={item.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block group"
                    >
                      <div className="flex items-start gap-4">
                        {/* Timeline dot */}
                        <div className="flex flex-col items-center pt-1.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                          <div className="w-px h-full bg-border mt-1" />
                        </div>

                        <div className="pb-6">
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="text-sm font-semibold group-hover:text-primary transition-colors">
                              {item.title}
                            </h3>
                            <StatusBadge status={item.status} />
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">
                            {formatDate(item.closed_at || item.created_at)}
                            {item.phase && (
                              <span className="ml-2">
                                Phase {item.phase}
                              </span>
                            )}
                          </p>
                          {item.body && (
                            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                              {item.body
                                .replace(/###?\s+\w+/g, "")
                                .replace(/[*_#]/g, "")
                                .trim()
                                .slice(0, 200)}
                            </p>
                          )}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <footer className="mt-16 pt-8 border-t">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-muted-foreground">
            <p>
              <a
                href="/roadmap"
                className="text-primary hover:underline"
              >
                View the roadmap
              </a>{" "}
              to see what&apos;s coming next.
            </p>
            <a
              href="https://github.com/jrygrande/dynasty-dna"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              View source on GitHub →
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
