"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  applyGraphFilters,
  pickKey,
  type Graph,
  type GraphFocus,
  type GraphResponse,
  type GraphSelection,
  type TransactionKind,
} from "@/lib/assetGraph";
import { useGraphVisibility, edgeAssetKey } from "@/lib/useGraphVisibility";
import { GraphFilterSidebar } from "@/components/graph/GraphFilterSidebar";
import { GraphDetailDrawer } from "@/components/graph/GraphDetailDrawer";
import { GraphHeaderStats } from "@/components/graph/GraphHeaderStats";
import { CopyLinkButton } from "@/components/graph/CopyLinkButton";
import { MobileDigest } from "@/components/graph/MobileDigest";
import { AssetPicker } from "@/components/graph/AssetPicker";
import { trackEvent } from "@/lib/analytics";
import { AssetGraph } from "@/components/graph/AssetGraph";

type FromSource = "overview" | "player" | "transactions" | "manager" | "deeplink";

const DEFAULT_TX_KINDS: TransactionKind[] = ["draft", "trade", "waiver", "free_agent"];
const ALL_TX_KINDS: TransactionKind[] = [
  "draft",
  "trade",
  "waiver",
  "free_agent",
  "commissioner",
];

function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseTxKinds(value: string | null): TransactionKind[] {
  const arr = parseCsv(value);
  return arr.filter((k): k is TransactionKind => ALL_TX_KINDS.includes(k as TransactionKind));
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

  const selectedSeasons = useMemo(() => parseCsv(searchParams.get("seasons")), [searchParams]);
  const selectedManagers = useMemo(() => parseCsv(searchParams.get("managers")), [searchParams]);
  const selectedTxKinds = useMemo<TransactionKind[]>(() => {
    const parsed = parseTxKinds(searchParams.get("txKinds"));
    return parsed.length > 0 ? parsed : DEFAULT_TX_KINDS;
  }, [searchParams]);

  const seedRaw = searchParams.get("seed");
  const expandedRaw = searchParams.get("expanded");
  const removedRaw = searchParams.get("removed");
  const seed = useMemo(() => parseCsv(seedRaw), [seedRaw]);
  const expanded = useMemo(() => new Set(parseCsv(expandedRaw)), [expandedRaw]);
  const removed = useMemo(() => new Set(parseCsv(removedRaw)), [removedRaw]);

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
        if (!res.ok) throw new Error(`Graph API ${res.status}`);
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

  const filteredGraph: Graph | null = useMemo(() => {
    if (!response) return null;
    return applyGraphFilters(
      { nodes: response.nodes, edges: response.edges, stats: response.stats },
      {
        seasons: selectedSeasons,
        managers: selectedManagers,
        txKinds: selectedTxKinds,
      },
    );
  }, [response, selectedSeasons, selectedManagers, selectedTxKinds]);

  const visibility = useGraphVisibility(filteredGraph, { seed, expanded, removed });

  const visibleGraph: Graph | null = useMemo(() => {
    if (!filteredGraph) return null;
    return {
      nodes: visibility.visibleNodes,
      edges: visibility.visibleEdges,
      stats: filteredGraph.stats,
    };
  }, [filteredGraph, visibility]);

  // Season bootstrap removed. In the transaction-node model a seed anchors
  // the view regardless of date — defaulting to the latest season would hide
  // older transactions that belong to the seed's thread. Empty seasons
  // filter means "all seasons," and that's the desired starting state.

  // Resolve seedPlayerId → concrete seed node ids (the most recent tenure
  // edge for that player; endpoints become the seed). Clears seasons filter
  // so the seed is visible regardless of the default latest-season bootstrap.
  const seedPlayerId = searchParams.get("seedPlayerId");
  useEffect(() => {
    if (!seedPlayerId || !response || seed.length > 0) return;
    const playerEdges = response.edges
      .filter((e) => e.assetKind === "player" && e.playerId === seedPlayerId);
    if (playerEdges.length === 0) {
      updateUrl({ seedPlayerId: null });
      return;
    }
    // Most recent: isOpen wins; otherwise latest end season/week.
    const latest = playerEdges.reduce((best, e) => {
      if (!best) return e;
      if (e.isOpen && !best.isOpen) return e;
      if (!e.isOpen && best.isOpen) return best;
      const bestSeason = best.endSeason ?? best.startSeason;
      const eSeason = e.endSeason ?? e.startSeason;
      if (eSeason !== bestSeason) return eSeason > bestSeason ? e : best;
      const bestWeek = best.endWeek ?? best.startWeek;
      const eWeek = e.endWeek ?? e.startWeek;
      return eWeek > bestWeek ? e : best;
    });
    const seedIds = Array.from(new Set([latest.source, latest.target]));
    updateUrl({
      seed: seedIds.join(","),
      seedPlayerId: null,
      seasons: null,
    });
  }, [seedPlayerId, response, seed.length, updateUrl]);

  // Resolve seedPickKey → concrete seed node ids (same pattern as seedPlayerId).
  const seedPickKey = searchParams.get("seedPickKey");
  useEffect(() => {
    if (!seedPickKey || !response || seed.length > 0) return;
    // seedPickKey format: "season:round:origRosterId"
    const targetAssetKey = `pick:${seedPickKey}`;
    const pickEdges = response.edges.filter(
      (e) => e.assetKind === "pick" && edgeAssetKey(e) === targetAssetKey,
    );
    if (pickEdges.length === 0) {
      updateUrl({ seedPickKey: null });
      return;
    }
    const latest = pickEdges.reduce((best, e) => {
      if (!best) return e;
      if (e.isOpen && !best.isOpen) return e;
      if (!e.isOpen && best.isOpen) return best;
      const bestSeason = best.endSeason ?? best.startSeason;
      const eSeason = e.endSeason ?? e.startSeason;
      if (eSeason !== bestSeason) return eSeason > bestSeason ? e : best;
      const bestWeek = best.endWeek ?? best.startWeek;
      const eWeek = e.endWeek ?? e.startWeek;
      return eWeek > bestWeek ? e : best;
    });
    const seedIds = Array.from(new Set([latest.source, latest.target]));
    updateUrl({
      seed: seedIds.join(","),
      seedPickKey: null,
      seasons: null,
    });
  }, [seedPickKey, response, seed.length, updateUrl]);

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
  const handleTxKindsChange = useCallback(
    (k: TransactionKind[]) => updateUrl({ txKinds: k.join(",") || null }),
    [updateUrl],
  );
  const handleCloseSelection = useCallback(() => updateUrl({ selection: null }), [updateUrl]);
  const handleSelectionChange = useCallback(
    (next: GraphSelection | null) => updateUrl({ selection: serializeSelection(next) }),
    [updateUrl],
  );

  const handleAssetExpand = useCallback(
    (nodeId: string, assetKey: string) => {
      const entry = `${nodeId}~${assetKey}`;
      const next = new Set(expanded);
      if (next.has(entry)) next.delete(entry);
      else next.add(entry);
      updateUrl({
        expanded: Array.from(next).join(",") || null,
      });
      trackEvent("graph_asset_expanded", { nodeId, assetKey });
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

  const handlePickerSelect = useCallback(
    (focus: GraphFocus) => {
      if (focus.kind === "player") {
        updateUrl({
          seedPlayerId: focus.playerId,
          seed: null,
          expanded: null,
          removed: null,
          selection: null,
          seasons: null,
        });
      } else {
        updateUrl({
          seedPickKey: pickKey({
            pickSeason: focus.pickSeason,
            pickRound: focus.pickRound,
            pickOriginalRosterId: focus.pickOriginalRosterId,
          }),
          seed: null,
          expanded: null,
          removed: null,
          selection: null,
          seasons: null,
        });
      }
      trackEvent("graph_picker_select", { kind: focus.kind });
    },
    [updateUrl],
  );

  const handleReset = useCallback(() => {
    updateUrl({
      seed: null,
      seedPlayerId: null,
      seedPickKey: null,
      expanded: null,
      removed: null,
      selection: null,
      seasons: null,
      managers: null,
      txKinds: null,
    });
  }, [updateUrl]);

  const filterCount = useMemo(() => {
    let n = 0;
    if (selectedSeasons.length > 0) n += 1;
    if (selectedManagers.length > 0) n += 1;
    if (selectedTxKinds.length !== DEFAULT_TX_KINDS.length) n += 1;
    if (seed.length > 0) n += 1;
    return n;
  }, [selectedSeasons, selectedManagers, selectedTxKinds, seed]);

  const seasonLabel = useMemo(() => {
    if (selectedSeasons.length === 1) return selectedSeasons[0];
    if (selectedSeasons.length > 1) return selectedSeasons.join(", ");
    return "";
  }, [selectedSeasons]);

  if (isNarrow) {
    return <MobileDigest familyId={familyId} response={response} loading={loading} />;
  }

  const hasSeed = seed.length > 0;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] min-h-0">
      <div className="border-b">
        <div className="px-6 py-3 flex items-center gap-4">
          <Link
            href={`/league/${familyId}`}
            className="text-sm text-muted-foreground hover:text-foreground whitespace-nowrap"
          >
            &larr; League
          </Link>
          <h1 className="text-lg font-semibold whitespace-nowrap">Trade network</h1>
          {hasSeed && (
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Reset
            </button>
          )}
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
              selectedTxKinds={selectedTxKinds}
              onSeasonsChange={handleSeasonsChange}
              onManagersChange={handleManagersChange}
              onTxKindsChange={handleTxKindsChange}
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
          {!hasSeed && response && !error && (
            <div className="flex items-center justify-center h-full">
              <AssetPicker familyId={familyId} onPick={handlePickerSelect} />
            </div>
          )}
          {hasSeed && visibleGraph && !error && (
            <AssetGraph
              nodes={visibleGraph.nodes}
              edges={visibleGraph.edges}
              selection={selection}
              onSelect={handleSelectionChange}
              seedIds={seed}
              expandedEntries={expanded}
              onAssetExpand={handleAssetExpand}
              onRemove={handleRemove}
            />
          )}

          {showOnboarding && (
            <div
              role="status"
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 max-w-md px-4 py-2.5 rounded-md bg-foreground text-background shadow-lg flex items-center gap-3"
            >
              <span className="text-xs">
                Click an asset row to trace its thread. Each edge is a player or pick tenure — the time they spent on one manager&apos;s roster.
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
