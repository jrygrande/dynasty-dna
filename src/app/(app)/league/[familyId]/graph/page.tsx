"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type {
  GraphEdge,
  GraphEdgeKind,
  GraphFocus,
  GraphNode,
  GraphResponse,
  GraphSelection,
} from "@/lib/assetGraph";
import type { EnrichedTransaction } from "@/lib/transactionEnrichment";
import { GraphFilterSidebar } from "@/components/graph/GraphFilterSidebar";
import { GraphDetailDrawer } from "@/components/graph/GraphDetailDrawer";
import { GraphHeaderStats } from "@/components/graph/GraphHeaderStats";
import { CopyLinkButton } from "@/components/graph/CopyLinkButton";
import { MobileDigest } from "@/components/graph/MobileDigest";
import { trackEvent } from "@/lib/analytics";
import { AssetGraph } from "@/components/graph/AssetGraph";

interface AssetGraphRendererProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  transactions: Record<string, EnrichedTransaction>;
  layoutMode: "band" | "dagre";
  selection: GraphSelection | null;
  onSelectionChange: (next: GraphSelection | null) => void;
}

function AssetGraphRenderer({
  nodes,
  edges,
  layoutMode,
  selection,
  onSelectionChange,
}: AssetGraphRendererProps) {
  return (
    <AssetGraph
      nodes={nodes}
      edges={edges}
      layoutMode={layoutMode}
      selection={selection}
      onSelect={onSelectionChange}
    />
  );
}

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

class InlineErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error("[graph] renderer error", error);
    }
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export default function GraphPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const familyId = params.familyId as string;

  // Parse URL params into strongly-typed state.
  const selectedSeasons = useMemo(() => parseCsv(searchParams.get("seasons")), [searchParams]);
  const selectedManagers = useMemo(() => parseCsv(searchParams.get("managers")), [searchParams]);
  const selectedEventTypes = useMemo<GraphEdgeKind[]>(() => {
    const parsed = parseEventTypes(searchParams.get("eventTypes"));
    return parsed.length > 0 ? parsed : DEFAULT_EVENT_TYPES;
  }, [searchParams]);

  const focusPlayerId = searchParams.get("focusPlayerId");
  const focusPickKey = searchParams.get("focusPickKey");
  const focusManagerId = searchParams.get("focusManagerId");
  const focusHops = Number.parseInt(searchParams.get("focusHops") ?? "2", 10) || 2;
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

  const focus: GraphFocus | null = useMemo(() => {
    if (focusPlayerId) return { kind: "player", playerId: focusPlayerId };
    if (focusPickKey) {
      const parts = focusPickKey.split(":");
      if (parts.length === 4) {
        const [leagueId, pickSeason, roundStr, originalRosterStr] = parts;
        const pickRound = Number.parseInt(roundStr, 10);
        const pickOriginalRosterId = Number.parseInt(originalRosterStr, 10);
        if (!Number.isNaN(pickRound) && !Number.isNaN(pickOriginalRosterId)) {
          return {
            kind: "pick",
            leagueId,
            pickSeason,
            pickRound,
            pickOriginalRosterId,
          };
        }
      }
    }
    if (focusManagerId) return { kind: "manager", userId: focusManagerId };
    return null;
  }, [focusPlayerId, focusPickKey, focusManagerId]);

  // URL mutation helper — preserves unspecified params.
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

  // Responsive breakpoint detection.
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

  // Fetch graph data when filter params change.
  const [response, setResponse] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const analyticsFiredRef = useRef(false);
  const seasonsBootstrappedRef = useRef(false);
  const focusBootstrappedRef = useRef(false);
  const [tooltipDismissed, setTooltipDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return Boolean(window.localStorage.getItem("graph_tooltip_dismissed"));
  });

  const fetchKey = useMemo(() => {
    return JSON.stringify({
      seasons: selectedSeasons,
      managers: selectedManagers,
      eventTypes: selectedEventTypes,
      focusPlayerId,
      focusPickKey,
      focusManagerId,
      focusHops,
      layout: layoutMode,
    });
  }, [
    selectedSeasons,
    selectedManagers,
    selectedEventTypes,
    focusPlayerId,
    focusPickKey,
    focusManagerId,
    focusHops,
    layoutMode,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        if (selectedSeasons.length > 0) qs.set("seasons", selectedSeasons.join(","));
        if (selectedManagers.length > 0) qs.set("managers", selectedManagers.join(","));
        if (selectedEventTypes.length > 0) qs.set("eventTypes", selectedEventTypes.join(","));
        if (focusPlayerId) qs.set("focusPlayerId", focusPlayerId);
        if (focusPickKey) qs.set("focusPickKey", focusPickKey);
        if (focusManagerId) qs.set("focusManagerId", focusManagerId);
        qs.set("focusHops", String(focusHops));
        qs.set("layout", layoutMode);
        const res = await fetch(`/api/leagues/${familyId}/graph?${qs.toString()}`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, fetchKey]);

  // Bootstrap: default seasons = latest season once first response lands.
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

  // Bootstrap: auto-focus on highest-hop transaction on first load (if no focus set).
  useEffect(() => {
    if (!response || focusBootstrappedRef.current) return;
    if (focus) {
      focusBootstrappedRef.current = true;
      return;
    }
    const trades = Object.values(response.transactions).filter((t) => t.type === "trade");
    if (trades.length === 0) {
      focusBootstrappedRef.current = true;
      return;
    }
    const top = trades.reduce<EnrichedTransaction | null>((best, tx) => {
      const hops = (tx.adds?.length ?? 0) + (tx.draftPicks?.length ?? 0);
      if (!best) return tx;
      const bestHops = (best.adds?.length ?? 0) + (best.draftPicks?.length ?? 0);
      return hops > bestHops ? tx : best;
    }, null);
    if (!top) {
      focusBootstrappedRef.current = true;
      return;
    }
    focusBootstrappedRef.current = true;
    if (top.managers.length > 0) {
      // Find a manager userId via response.managers — rosterId in EnrichedTransaction
      // is per-league; we map to userId by matching display name where possible.
      const managerRosterId = top.managers[0].rosterId;
      const managerName = top.managers[0].name;
      const managerNode = response.nodes.find(
        (n) => n.kind === "manager" && n.displayName === managerName,
      );
      if (managerNode && managerNode.kind === "manager") {
        updateUrl({ focusManagerId: managerNode.userId });
        trackEvent("graph_focus_set", { focusType: "manager", hops: focusHops });
        return;
      }
      // Fallback: focus on first add's player.
      if (top.adds.length > 0) {
        updateUrl({ focusPlayerId: top.adds[0].playerId });
        trackEvent("graph_focus_set", { focusType: "player", hops: focusHops });
      }
      // Unreferenced in fallback: managerRosterId.
      void managerRosterId;
    }
  }, [response, focus, focusHops, updateUrl]);

  // Analytics: fire graph_view_opened once per response.
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

  // Dismissable onboarding toast.
  const showOnboarding =
    !tooltipDismissed && response !== null && response.nodes.length > 0;
  const dismissOnboarding = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("graph_tooltip_dismissed", "1");
    }
    setTooltipDismissed(true);
  }, []);

  // Filter change handlers.
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
  const handleFocusChange = useCallback(
    (f: GraphFocus | null) => {
      const updates: Record<string, string | null> = {
        focusPlayerId: null,
        focusPickKey: null,
        focusManagerId: null,
      };
      if (f?.kind === "player") updates.focusPlayerId = f.playerId;
      else if (f?.kind === "pick") {
        updates.focusPickKey = `${f.leagueId}:${f.pickSeason}:${f.pickRound}:${f.pickOriginalRosterId}`;
      } else if (f?.kind === "manager") updates.focusManagerId = f.userId;
      updateUrl(updates);
      if (f) trackEvent("graph_focus_set", { focusType: f.kind, hops: focusHops });
    },
    [updateUrl, focusHops],
  );
  const handleFocusHopsChange = useCallback(
    (n: number) => updateUrl({ focusHops: String(n) }),
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

  const filterCount = useMemo(() => {
    let n = 0;
    if (selectedSeasons.length > 0) n += 1;
    if (selectedManagers.length > 0) n += 1;
    if (selectedEventTypes.length !== DEFAULT_EVENT_TYPES.length) n += 1;
    if (focus) n += 1;
    if (layoutMode !== "band") n += 1;
    return n;
  }, [selectedSeasons, selectedManagers, selectedEventTypes, focus, layoutMode]);

  const seasonLabel = useMemo(() => {
    if (selectedSeasons.length === 1) return selectedSeasons[0];
    if (selectedSeasons.length > 1) return selectedSeasons.join(", ");
    if (response?.seasons?.length) {
      const sorted = [...response.seasons].sort().reverse();
      return sorted[0];
    }
    return "";
  }, [selectedSeasons, response]);

  // Mobile digest for narrow viewports.
  if (isNarrow) {
    return <MobileDigest familyId={familyId} response={response} loading={loading} />;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Top header */}
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
          {response && (
            <GraphHeaderStats stats={response.stats} seasonLabel={seasonLabel} />
          )}
          <CopyLinkButton hasFocus={Boolean(focus)} filterCount={filterCount} />
        </div>
      </div>

      {/* Main three-column area */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Sidebar */}
        <div className="w-72 border-r overflow-y-auto p-4 shrink-0">
          {response ? (
            <GraphFilterSidebar
              seasons={response.seasons}
              managers={response.managers}
              selectedSeasons={selectedSeasons}
              selectedManagers={selectedManagers}
              selectedEventTypes={selectedEventTypes}
              focus={focus}
              focusHops={focusHops}
              layoutMode={layoutMode}
              onSeasonsChange={handleSeasonsChange}
              onManagersChange={handleManagersChange}
              onEventTypesChange={handleEventTypesChange}
              onFocusChange={handleFocusChange}
              onFocusHopsChange={handleFocusHopsChange}
              onLayoutModeChange={handleLayoutModeChange}
            />
          ) : (
            <SidebarSkeleton />
          )}
        </div>

        {/* Center canvas */}
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
          {response && !error && (
            <InlineErrorBoundary
              fallback={
                <div className="flex items-center justify-center h-full p-6">
                  <p className="text-sm text-destructive">
                    Graph renderer crashed. Try changing filters or reloading.
                  </p>
                </div>
              }
            >
              <AssetGraphRenderer
                nodes={response.nodes}
                edges={response.edges}
                transactions={response.transactions}
                layoutMode={layoutMode}
                selection={selection}
                onSelectionChange={handleSelectionChange}
              />
            </InlineErrorBoundary>
          )}

          {/* Onboarding toast */}
          {showOnboarding && (
            <div
              role="status"
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 max-w-md px-4 py-2.5 rounded-md bg-foreground text-background shadow-lg flex items-center gap-3"
            >
              <span className="text-xs">
                Click a manager to see their assets. Click an edge to see the trade.
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

        {/* Right drawer (conditional) */}
        {selection && response && (
          <GraphDetailDrawer
            selection={selection}
            nodes={response.nodes}
            edges={response.edges}
            transactions={response.transactions}
            familyId={familyId}
            onClose={handleCloseSelection}
          />
        )}
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
