"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Dna, Smartphone, X } from "lucide-react";
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
import { MobileTimeline } from "@/components/graph/MobileTimeline";
import { AssetPicker } from "@/components/graph/AssetPicker";
import { trackEvent } from "@/lib/analytics";
import { AssetGraph } from "@/components/graph/AssetGraph";
import { Button } from "@/components/ui/button";
import { Subheader } from "@/components/Subheader";
import { useScrolled } from "@/lib/useScrolled";
import type { Pos } from "@/components/graph/layout";

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
    const ids = value.slice(5).split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return null;
    return { type: "edge", edgeIds: ids };
  }
  return null;
}

function serializeSelection(sel: GraphSelection | null): string | null {
  if (!sel) return null;
  if (sel.type === "node") return `node:${sel.nodeId}`;
  if (sel.edgeIds.length === 0) return null;
  return `edge:${sel.edgeIds.join(",")}`;
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
  const [isLandscape, setIsLandscape] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth > window.innerHeight;
  });
  useEffect(() => {
    function onResize() {
      setIsNarrow(window.innerWidth < 1024);
      setIsLandscape(window.innerWidth > window.innerHeight);
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  // Narrow viewport in portrait gets the chronological MobileTimeline. Narrow
  // landscape (phones rotated) falls through to the React Flow canvas — same
  // experience as desktop, just at a tighter viewport.
  const isPortraitMobile = isNarrow && !isLandscape;

  // Fullbleed-on-mobile: lets the global nav scroll off so the subheader
  // pins to viewport top, freeing screen space for the canvas/timeline.
  useEffect(() => {
    document.body.classList.add("page-fullbleed-mobile");
    return () => {
      document.body.classList.remove("page-fullbleed-mobile");
    };
  }, []);

  const scrolled = useScrolled(8);

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

  // Resolve seedTransactionId → the tx:* node directly. Transactions are
  // graph nodes themselves (id = `tx:${transactionId}`), so we can seed
  // straight to that node and let the user pivot from there.
  const seedTransactionId = searchParams.get("seedTransactionId");
  useEffect(() => {
    if (!seedTransactionId || !response || seed.length > 0) return;
    const nodeId = `tx:${seedTransactionId}`;
    const exists = response.nodes.some((n) => n.id === nodeId);
    if (!exists) {
      updateUrl({ seedTransactionId: null });
      return;
    }
    updateUrl({ seed: nodeId });
  }, [seedTransactionId, response, seed.length, updateUrl]);

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

  // User-dragged card overrides for the auto-layout. Cleared on topology
  // change (seed swap, chain expansion) so a card dragged earlier can't
  // sit somewhere that breaks chronological order for a newly-revealed
  // thread — that's the wrap-around edge the issue calls out.
  const [manualPositions, setManualPositions] = useState<Map<string, Pos>>(
    () => new Map(),
  );
  const handleManualPositionChange = useCallback((nodeId: string, pos: Pos) => {
    setManualPositions((prev) => {
      const next = new Map(prev);
      next.set(nodeId, pos);
      return next;
    });
  }, []);
  const handleResetManualPositions = useCallback(() => {
    setManualPositions((prev) => (prev.size === 0 ? prev : new Map()));
  }, []);
  const seedKey = seed.join(",");
  // Sorted so insertion order doesn't trigger spurious resets.
  const visibleNodeHash = useMemo(() => {
    const ids = visibility.visibleNodes.map((n) => n.id);
    ids.sort();
    return ids.join(",");
  }, [visibility.visibleNodes]);
  useEffect(() => {
    setManualPositions((prev) => (prev.size === 0 ? prev : new Map()));
  }, [seedKey, visibleNodeHash]);

  const hasSeed = seed.length > 0;
  const selectedNodeId =
    selection?.type === "node" ? selection.nodeId : null;

  // Allowed per design: graph headers may use Source Serif 4 (relaxes marketing-only rule).
  // Portrait mobile: Reset rides the title row so the collapsed subheader stays
  // one row tall. Landscape phones + desktop: Reset moves into the right slot.
  const subheaderTitle = (
    <div className="flex items-center gap-2">
      <h1 className="font-serif text-lg sm:text-xl font-medium text-sage-800 inline-flex items-center gap-2 flex-1 min-w-0">
        <Dna className="h-5 w-5 text-primary" aria-hidden="true" />
        Lineage Tracer
      </h1>
      {isPortraitMobile && hasSeed && (
        <Button
          type="button"
          onClick={handleReset}
          variant="ghost"
          size="sm"
          className="shrink-0"
        >
          Reset
        </Button>
      )}
    </div>
  );

  // Portrait mobile only: hide the stats once the user starts scrolling so the
  // sticky subheader collapses to just title + Reset (more screen space for cards).
  const showStats = graph && !(isPortraitMobile && scrolled);

  const subheaderRightSlot = (
    <>
      {showStats && <GraphHeaderStats stats={graph.stats} />}
      {!isPortraitMobile && manualPositions.size > 0 && (
        <Button
          type="button"
          onClick={handleResetManualPositions}
          variant="ghost"
          size="sm"
          title="Clear dragged-card positions"
        >
          Reset positions
        </Button>
      )}
      {!isPortraitMobile && hasSeed && (
        <Button type="button" onClick={handleReset} variant="ghost" size="sm">
          Reset
        </Button>
      )}
    </>
  );

  if (isPortraitMobile) {
    return (
      <>
        <Subheader title={subheaderTitle} rightSlot={subheaderRightSlot} />
        <RotateForCanvasHint />
        <SmallScreenHint />
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
        />
        {selection && visibility.visibleNodes.length > 0 && response && (
          <GraphDetailDrawer
            selection={selection}
            nodes={visibility.visibleNodes}
            edges={visibility.visibleEdges}
            transactions={response.transactions}
            familyId={familyId}
            onSelectionChange={handleSelectionChange}
            variant="sheet"
          />
        )}
      </>
    );
  }

  return (
    <>
      <Subheader title={subheaderTitle} rightSlot={subheaderRightSlot} />
      <SmallScreenHint />
      <div className="flex flex-col h-[calc(100vh-var(--nav-height,3.5rem)-var(--subheader-height,3rem))] min-h-0">
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
                manualPositions={manualPositions}
                onManualPositionChange={handleManualPositionChange}
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
              onSelectionChange={handleSelectionChange}
            />
          )}
        </div>
      </div>
    </>
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

const ROTATE_HINT_KEY = "graph_rotate_hint_dismissed";
const SMALL_SCREEN_HINT_KEY = "graph_small_screen_hint_dismissed";

function RotateForCanvasHint() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return Boolean(window.localStorage.getItem(ROTATE_HINT_KEY));
  });
  if (dismissed) return null;
  return (
    <div
      role="status"
      className="mx-4 mt-3 flex items-center gap-3 rounded-md border border-primary/25 bg-primary/8 px-3 py-2 text-xs text-foreground"
    >
      <Smartphone className="h-4 w-4 shrink-0 text-primary -rotate-90" aria-hidden="true" />
      <span className="flex-1">
        Rotate your phone for the interactive canvas.
      </span>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem(ROTATE_HINT_KEY, "1");
          } catch {
            // localStorage may be unavailable (private mode); dismissal is in-memory only.
          }
        }}
        aria-label="Dismiss rotate hint"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function SmallScreenHint() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return Boolean(window.localStorage.getItem(SMALL_SCREEN_HINT_KEY));
  });
  if (dismissed) return null;
  return (
    <div
      role="status"
      data-small-screen-hint
      className="fixed bottom-3 left-1/2 z-30 -translate-x-1/2 flex items-center gap-2 rounded-full border border-border bg-card/95 backdrop-blur px-3 py-1.5 text-[11px] text-muted-foreground shadow-md"
    >
      <span>Lineage Tracer works best on a larger screen.</span>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem(SMALL_SCREEN_HINT_KEY, "1");
          } catch {
            // localStorage may be unavailable (private mode); dismissal is in-memory only.
          }
        }}
        aria-label="Dismiss small-screen hint"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}
