"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  applyGraphFilters,
  type Graph,
  type GraphEdgeKind,
  type GraphResponse,
  type GraphSelection,
} from "@/lib/assetGraph";
import { useGraphVisibility } from "@/lib/useGraphVisibility";
import { GraphFilterSidebar } from "@/components/graph/GraphFilterSidebar";
import { GraphDetailDrawer } from "@/components/graph/GraphDetailDrawer";
import { GraphHeaderStats } from "@/components/graph/GraphHeaderStats";
import { CopyLinkButton } from "@/components/graph/CopyLinkButton";
import { MobileDigest } from "@/components/graph/MobileDigest";
import { trackEvent } from "@/lib/analytics";
import { AssetGraph } from "@/components/graph/AssetGraph";

type FromSource = "overview" | "player" | "transactions" | "manager" | "deeplink";

const DEFAULT_EVENT_TYPES: GraphEdgeKind[] = [
  "trade_out",
  "trade_in",
  "pick_trade_out",
  "pick_trade_in",
  "draft_selected_mgr",
  "draft_selected_pick",
];

const ALL_EDGE_KINDS: GraphEdgeKind[] = [
  "trade_out",
  "trade_in",
  "pick_trade_out",
  "pick_trade_in",
  "draft_selected_mgr",
  "draft_selected_pick",
  "waiver_add",
  "free_agent_add",
];

function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseEventTypes(value: string | null): GraphEdgeKind[] {
  const arr = parseCsv(value);
  return arr.filter((k): k is GraphEdgeKind => ALL_EDGE_KINDS.includes(k as GraphEdgeKind));
}

function parseSelection(value: string | null): GraphSelection | null {
  if (!value) return null;
  if (value.startsWith("node:")) {
    return { type: "node", nodeId: value.slice(5) };
  }
  if (value.startsWith("edge:")) {
    return { type: "edge", edgeId: value.slice(5) };
  }
  return null;
}

function serializeSelection(sel: GraphSelection | null): string | null {
  if (!sel) return null;
  if (sel.type === "node") return `node:${sel.nodeId}`;
  return `edge:${sel.edgeId}`;
}

export default function GraphPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const familyId = params.familyId as string;

  // URL state.
  const selectedSeasons = useMemo(() => parseCsv(searchParams.get("seasons")), [searchParams]);
  const selectedManagers = useMemo(() => parseCsv(searchParams.get("managers")), [searchParams]);
  const selectedEventTypes = useMemo<GraphEdgeKind[]>(() => {
    const parsed = parseEventTypes(searchParams.get("eventTypes"));
    return parsed.length > 0 ? parsed : DEFAULT_EVENT_TYPES;
  }, [searchParams]);

  const seedRaw = searchParams.get("seed");
  const expandedRaw = searchParams.get("expanded");
  const removedRaw = searchParams.get("removed");
  const seed = useMemo(() => parseCsv(seedRaw), [seedRaw]);
  const expanded = useMemo(() => new Set(parseCsv(expandedRaw)), [expandedRaw]);
  const removed = useMemo(() => new Set(parseCsv(removedRaw)), [removedRaw]);

  const layoutMode: "band" | "dagre" =
    searchParams.get("layout") === "dagre" ? "dagre" : "band";
  const selection = parseSelection(searchParams.get("selection"));
  const from = ((): FromSource => {
    const raw = searchParams.get("from");
    if (raw === "overview" || raw === "player" || raw === "transactions" || raw === "manager") {
      return raw;
    }
    return "deeplink";
  })();

  const updateUrl = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const [isNarrow, setIsNarrow] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 1024;
  });
  useEffect(() => {
    function onResize() {
      setIsNarrow(window.innerWidth < 1024);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [response, setResponse] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const analyticsFiredRef = useRef(false);
  const seasonsBootstrappedRef = useRef(false);
  const [tooltipDismissed, setTooltipDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return Boolean(window.localStorage.getItem("graph_tooltip_dismissed"));
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/leagues/${familyId}/graph`);
        if (!res.ok) {
          throw new Error(`Graph API ${res.status}`);
        }
        const json = (await res.json()) as GraphResponse;
        if (!cancelled) setResponse(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load graph");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [familyId]);

  // Season/manager/eventType filters are client-side on the fetched graph.
  const filteredGraph: Graph | null = useMemo(() => {
    if (!response) return null;
    return applyGraphFilters(
      { nodes: response.nodes, edges: response.edges, stats: response.stats },
      {
        seasons: selectedSeasons,
        managers: selectedManagers,
        eventTypes: selectedEventTypes,
        focus: null,
        focusHops: 0,
        layout: layoutMode,
      },
    );
  }, [response, selectedSeasons, selectedManagers, selectedEventTypes, layoutMode]);

  // Progressive-disclosure visibility: seed + expansions − removed.
  const visibility = useGraphVisibility(filteredGraph, { seed, expanded, removed });

  const visibleGraph: Graph | null = useMemo(() => {
    if (!filteredGraph) return null;
    return {
      nodes: visibility.visibleNodes,
      edges: visibility.visibleEdges,
      stats: filteredGraph.stats,
    };
  }, [filteredGraph, visibility]);

  // Bootstrap default seasons once response lands.
  useEffect(() => {
    if (!response || seasonsBootstrappedRef.current) return;
    if (selectedSeasons.length === 0 && response.seasons.length > 0) {
      const latest = [...response.seasons].sort().reverse()[0];
      seasonsBootstrappedRef.current = true;
      updateUrl({ seasons: latest });
    } else {
      seasonsBootstrappedRef.current = true;
    }
  }, [response, selectedSeasons.length, updateUrl]);

  useEffect(() => {
    if (!response || analyticsFiredRef.current) return;
    analyticsFiredRef.current = true;
    trackEvent("graph_view_opened", {
      familyId,
      from,
      nodeCount: response.nodes.length,
      edgeCount: response.edges.length,
      season: selectedSeasons.join(",") || response.seasons[0] || "",
    });
  }, [response, familyId, from, selectedSeasons]);

  const showOnboarding =
    !tooltipDismissed && visibility.visibleNodes.length > 0;
  const dismissOnboarding = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("graph_tooltip_dismissed", "1");
    }
    setTooltipDismissed(true);
  }, []);

  const handleSeasonsChange = useCallback(
    (seasons: string[]) => updateUrl({ seasons: seasons.join(",") || null }),
    [updateUrl],
  );
  const handleManagersChange = useCallback(
    (m: string[]) => updateUrl({ managers: m.join(",") || null }),
    [updateUrl],
  );
  const handleEventTypesChange = useCallback(
    (e: GraphEdgeKind[]) => updateUrl({ eventTypes: e.join(",") || null }),
    [updateUrl],
  );
  const handleLayoutModeChange = useCallback(
    (m: "band" | "dagre") => updateUrl({ layout: m }),
    [updateUrl],
  );
  const handleCloseSelection = useCallback(() => updateUrl({ selection: null }), [updateUrl]);
  const handleSelectionChange = useCallback(
    (next: GraphSelection | null) => updateUrl({ selection: serializeSelection(next) }),
    [updateUrl],
  );

  const handleExpand = useCallback(
    (nodeId: string) => {
      if (expanded.has(nodeId)) return;
      const next = Array.from(expanded);
      next.push(nodeId);
      updateUrl({
        expanded: next.join(","),
        selection: `node:${nodeId}`,
      });
      trackEvent("graph_node_expanded", { nodeId });
    },
    [expanded, updateUrl],
  );

  const handleRemove = useCallback(
    (nodeId: string) => {
      const nextRemoved = new Set(removed);
      nextRemoved.add(nodeId);
      const nextExpanded = new Set(expanded);
      nextExpanded.delete(nodeId);
      const nextSeed = seed.filter((id) => id !== nodeId);
      const updates: Record<string, string | null> = {
        removed: Array.from(nextRemoved).join(",") || null,
        expanded: Array.from(nextExpanded).join(",") || null,
        seed: nextSeed.join(",") || null,
      };
      if (selection?.type === "node" && selection.nodeId === nodeId) {
        updates.selection = null;
      }
      updateUrl(updates);
      trackEvent("graph_node_removed", { nodeId });
    },
    [expanded, removed, seed, selection, updateUrl],
  );

  const filterCount = useMemo(() => {
    let n = 0;
    if (selectedSeasons.length > 0) n += 1;
    if (selectedManagers.length > 0) n += 1;
    if (selectedEventTypes.length !== DEFAULT_EVENT_TYPES.length) n += 1;
    if (seed.length > 0) n += 1;
    if (layoutMode !== "band") n += 1;
    return n;
  }, [selectedSeasons, selectedManagers, selectedEventTypes, seed, layoutMode]);

  const seasonLabel = useMemo(() => {
    if (selectedSeasons.length === 1) return selectedSeasons[0];
    if (selectedSeasons.length > 1) return selectedSeasons.join(", ");
    if (response?.seasons?.length) {
      const sorted = [...response.seasons].sort().reverse();
      return sorted[0];
    }
    return "";
  }, [selectedSeasons, response]);

  if (isNarrow) {
    return <MobileDigest familyId={familyId} response={response} loading={loading} />;
  }

  const hasSeed = seed.length > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="border-b">
        <div className="px-6 py-3 flex items-center gap-4">
          <Link
            href={`/league/${familyId}`}
            className="text-sm text-muted-foreground hover:text-foreground whitespace-nowrap"
          >
            &larr; League
          </Link>
          <h1 className="text-lg font-semibold whitespace-nowrap">Trade network</h1>
          <div className="flex-1" />
          {filteredGraph && (
            <GraphHeaderStats stats={filteredGraph.stats} seasonLabel={seasonLabel} />
          )}
          <CopyLinkButton hasFocus={hasSeed} filterCount={filterCount} />
        </div>
      </div>

      <div className="flex-1 flex min-h-0 relative">
        <div className="w-72 border-r overflow-y-auto p-4 shrink-0">
          {response ? (
            <GraphFilterSidebar
              seasons={response.seasons}
              managers={response.managers}
              selectedSeasons={selectedSeasons}
              selectedManagers={selectedManagers}
              selectedEventTypes={selectedEventTypes}
              layoutMode={layoutMode}
              onSeasonsChange={handleSeasonsChange}
              onManagersChange={handleManagersChange}
              onEventTypesChange={handleEventTypesChange}
              onLayoutModeChange={handleLayoutModeChange}
            />
          ) : (
            <SidebarSkeleton />
          )}
        </div>

        <div className="flex-1 relative min-w-0">
          {loading && !response && <CanvasSkeleton />}
          {error && !loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3">
                <p className="text-sm text-destructive">{error}</p>
                <button
                  type="button"
                  onClick={() => updateUrl({})}
                  className="px-3 py-1.5 text-xs rounded-md border hover:bg-accent hover:text-accent-foreground"
                >
                  Retry
                </button>
              </div>
            </div>
          )}
          {!hasSeed && response && !error && <EmptyState familyId={familyId} />}
          {hasSeed && visibleGraph && !error && (
            <AssetGraph
              nodes={visibleGraph.nodes}
              edges={visibleGraph.edges}
              layoutMode={layoutMode}
              selection={selection}
              onSelect={handleSelectionChange}
              expandedNodeIds={expanded}
              onExpand={handleExpand}
              onRemove={handleRemove}
            />
          )}

          {showOnboarding && (
            <div
              role="status"
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 max-w-md px-4 py-2.5 rounded-md bg-foreground text-background shadow-lg flex items-center gap-3"
            >
              <span className="text-xs">
                Click a node to expand its trade partners. Click again to see details. Hover for the × to remove.
              </span>
              <button
                type="button"
                onClick={dismissOnboarding}
                className="text-xs underline hover:no-underline"
              >
                Got it
              </button>
            </div>
          )}
        </div>

        {selection && visibleGraph && response && (
          <GraphDetailDrawer
            selection={selection}
            nodes={visibleGraph.nodes}
            edges={visibleGraph.edges}
            transactions={response.transactions}
            familyId={familyId}
            onClose={handleCloseSelection}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState({ familyId }: { familyId: string }) {
  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-lg font-semibold">Start with an asset</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The trade network grows around whatever you seed it with. Open a player,
          manager, or transaction to start — then click nodes to pull in their
          partners one hop at a time.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            href={`/league/${familyId}`}
            className="px-3 py-1.5 text-sm rounded-md border bg-card hover:bg-accent hover:text-accent-foreground"
          >
            Back to league
          </Link>
          <Link
            href={`/league/${familyId}/transactions`}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Browse transactions
          </Link>
        </div>
      </div>
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-14 rounded-md border bg-muted/30 animate-pulse"
        />
      ))}
    </div>
  );
}

function CanvasSkeleton() {
  return (
    <div className="h-full w-full p-6 space-y-4">
      <div className="h-8 w-48 rounded-md bg-muted/30 animate-pulse" />
      <div className="h-[60%] rounded-lg bg-muted/30 animate-pulse" />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-md bg-muted/30 animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
