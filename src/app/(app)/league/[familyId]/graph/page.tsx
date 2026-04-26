"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Dna } from "lucide-react";
import {
  pickKey,
  type Graph,
  type GraphFocus,
  type GraphResponse,
  type GraphSelection,
} from "@/lib/assetGraph";
import { useGraphVisibility, edgeAssetKey } from "@/lib/useGraphVisibility";
import { GraphDetailDrawer } from "@/components/graph/GraphDetailDrawer";
import { GraphHeaderStats } from "@/components/graph/GraphHeaderStats";
import { CopyLinkButton } from "@/components/graph/CopyLinkButton";
import { MobileTimeline } from "@/components/graph/MobileTimeline";
import { AssetPicker } from "@/components/graph/AssetPicker";
import { trackEvent } from "@/lib/analytics";
import { AssetGraph } from "@/components/graph/AssetGraph";

type FromSource = "overview" | "player" | "transactions" | "manager" | "deeplink";

// `removed` URL state was retired with RemoveButton. Keep an empty set so the
// VisibilityState shape stays stable; stale `?removed=...` params are ignored.
const EMPTY_REMOVED: Set<string> = new Set();

function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
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

  const seedRaw = searchParams.get("seed");
  const expandedRaw = searchParams.get("expanded");
  const fullyExpandedRaw = searchParams.get("fullyExpanded");
  const seed = useMemo(() => parseCsv(seedRaw), [seedRaw]);
  const expanded = useMemo(() => new Set(parseCsv(expandedRaw)), [expandedRaw]);
  const fullyExpanded = useMemo(
    () => new Set(parseCsv(fullyExpandedRaw)),
    [fullyExpandedRaw],
  );

  const seedAssetKey = useMemo<string | undefined>(() => {
    const playerId = searchParams.get("seedPlayerId");
    if (playerId) return `player:${playerId}`;
    const pickKeyParam = searchParams.get("seedPickKey");
    if (pickKeyParam) return `pick:${pickKeyParam}`;
    return undefined;
  }, [searchParams]);

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

  const graph: Graph | null = useMemo(
    () =>
      response
        ? { nodes: response.nodes, edges: response.edges, stats: response.stats }
        : null,
    [response],
  );

  const visibility = useGraphVisibility(graph, {
    seed,
    expanded,
    removed: EMPTY_REMOVED,
    seedAssetKey,
  });

  const visibleGraph: Graph | null = useMemo(() => {
    if (!graph) return null;
    return {
      nodes: visibility.visibleNodes,
      edges: visibility.visibleEdges,
      stats: graph.stats,
    };
  }, [graph, visibility]);

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
    // Keep seedPlayerId in the URL so seedAssetKey survives reload/share-link.
    // The `seed.length > 0` guard above prevents re-resolution.
    updateUrl({
      seed: seedIds.join(","),
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
    // Keep seedPickKey in the URL so seedAssetKey survives reload/share-link.
    // The `seed.length > 0` guard above prevents re-resolution.
    updateUrl({
      seed: seedIds.join(","),
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
      season: response.seasons[0] || "",
    });
  }, [response, familyId, from]);

  const showOnboarding =
    !tooltipDismissed && visibility.visibleNodes.length > 0;
  const dismissOnboarding = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("graph_tooltip_dismissed", "1");
    }
    setTooltipDismissed(true);
  }, []);

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

  const handleHeaderToggle = useCallback(
    (nodeId: string) => {
      const next = new Set(fullyExpanded);
      const willExpand = !next.has(nodeId);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      updateUrl({ fullyExpanded: Array.from(next).join(",") || null });
      trackEvent("graph_card_expanded", { nodeId, expanded: willExpand });
    },
    [fullyExpanded, updateUrl],
  );

  const handlePickerSelect = useCallback(
    (focus: GraphFocus) => {
      if (focus.kind === "player") {
        updateUrl({
          seedPlayerId: focus.playerId,
          seed: null,
          expanded: null,
          fullyExpanded: null,
          selection: null,
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
          fullyExpanded: null,
          selection: null,
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
      fullyExpanded: null,
      selection: null,
    });
  }, [updateUrl]);

  const hasSeed = seed.length > 0;
  const selectedNodeId =
    selection?.type === "node" ? selection.nodeId : null;

  if (isNarrow) {
    return (
      <>
        <MobileTimeline
          familyId={familyId}
          response={response}
          loading={loading}
          seed={seed}
          expanded={expanded}
          fullyExpanded={fullyExpanded}
          selectedNodeId={selectedNodeId}
          seedAssetKey={seedAssetKey}
          onPickerSelect={handlePickerSelect}
          onAssetClick={handleAssetExpand}
          onHeaderToggle={handleHeaderToggle}
          onSelect={(nodeId) =>
            handleSelectionChange({ type: "node", nodeId })
          }
          onReset={handleReset}
        />
        {selection && visibility.visibleNodes.length > 0 && response && (
          <GraphDetailDrawer
            selection={selection}
            nodes={visibility.visibleNodes}
            edges={visibility.visibleEdges}
            transactions={response.transactions}
            familyId={familyId}
            onClose={handleCloseSelection}
            variant="sheet"
          />
        )}
      </>
    );
  }

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
          {/* Allowed per design: graph headers may use Source Serif 4 (relaxes marketing-only rule). */}
          <h1 className="font-serif text-xl font-medium text-sage-800 whitespace-nowrap inline-flex items-center gap-2">
            <Dna className="h-5 w-5 text-primary" aria-hidden="true" />
            Lineage Tracer
          </h1>
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
          {graph && <GraphHeaderStats stats={graph.stats} />}
          <CopyLinkButton hasFocus={hasSeed} />
        </div>
      </div>

      <div className="flex-1 flex min-h-0 relative">
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
              chainAssetsByNode={visibility.chainAssetsByNode}
              fullyExpanded={fullyExpanded}
              onHeaderToggle={handleHeaderToggle}
            />
          )}

          {showOnboarding && (
            <div
              role="status"
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 max-w-md px-4 py-2.5 rounded-md bg-foreground text-background shadow-lg flex items-center gap-3"
            >
              <span className="text-xs">
                Click a card header to expand it. Click an asset to follow its thread across stints between managers.
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
