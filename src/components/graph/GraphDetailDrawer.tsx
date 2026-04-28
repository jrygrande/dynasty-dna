"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import type { GraphEdge, GraphNode, GraphSelection } from "@/lib/assetGraph";
import type { EnrichedTransaction } from "@/lib/transactionEnrichment";
import { TransactionCard, type TransactionData } from "@/components/TransactionCard";
import { trackEvent } from "@/lib/analytics";

function toTransactionData(tx: EnrichedTransaction): TransactionData {
  return {
    ...tx,
    draftPicks: tx.draftPicks.map((p) => ({
      ...p,
      originalOwnerName: p.originalOwnerName ?? undefined,
    })),
  };
}

interface GraphDetailDrawerProps {
  selection: GraphSelection;
  nodes: GraphNode[];
  edges: GraphEdge[];
  transactions: Record<string, EnrichedTransaction>;
  familyId: string;
  onClose: () => void;
  /** Replace the current selection (called when removing a single column from compare mode). */
  onSelectionChange?: (next: GraphSelection | null) => void;
  /**
   * "drawer" (default): right-side fixed panel for desktop.
   * "sheet": full-screen overlay for mobile.
   */
  variant?: "drawer" | "sheet";
}

export function GraphDetailDrawer({
  selection,
  nodes,
  edges,
  transactions,
  familyId,
  onClose,
  onSelectionChange,
  variant = "drawer",
}: GraphDetailDrawerProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selectionFingerprint =
    selection.type === "node"
      ? `node:${selection.nodeId}`
      : `edge:${selection.edgeIds.join(",")}`;
  useEffect(() => {
    if (selection.type === "node") {
      const node = nodes.find((n) => n.id === selection.nodeId);
      trackEvent("graph_node_selected", { kind: node?.kind ?? "unknown" });
    } else if (selection.edgeIds.length === 1) {
      const edge = edges.find((e) => e.id === selection.edgeIds[0]);
      trackEvent("graph_edge_selected", {
        assetKind: edge?.assetKind ?? "unknown",
        isOpen: edge?.isOpen ?? false,
      });
    } else {
      trackEvent("graph_edges_compared", { count: selection.edgeIds.length });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionFingerprint]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !panelRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    closeBtnRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const isCompare = selection.type === "edge" && selection.edgeIds.length >= 2;
  const widthClass = isCompare ? "w-[40rem]" : "w-96";
  const containerClass =
    variant === "sheet"
      ? "fixed inset-0 bg-card overflow-y-auto z-50"
      : `absolute top-0 right-0 bottom-0 ${widthClass} bg-card border-l border-border/60 shadow-lg overflow-y-auto z-10`;

  const handleRemoveEdge = onSelectionChange
    ? (edgeId: string) => {
        if (selection.type !== "edge") return;
        const next = selection.edgeIds.filter((id) => id !== edgeId);
        onSelectionChange(next.length === 0 ? null : { type: "edge", edgeIds: next });
      }
    : undefined;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Graph detail"
      className={containerClass}
    >
      <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-border/60 bg-card">
        {/* Allowed per design: graph headers may use Source Serif 4 (relaxes marketing-only rule). */}
        <h2 className="font-serif text-base text-sage-800">
          {isCompare
            ? `Comparing ${(selection as { edgeIds: string[] }).edgeIds.length} stints`
            : "Details"}
        </h2>
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent hover:text-accent-foreground"
          aria-label="Close details"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {selection.type === "node" ? (
          <NodeDetail
            node={nodes.find((n) => n.id === selection.nodeId) ?? null}
            transactions={transactions}
            familyId={familyId}
          />
        ) : selection.edgeIds.length >= 2 ? (
          <EdgeCompare
            edges={selection.edgeIds
              .map((id) => edges.find((e) => e.id === id))
              .filter((e): e is GraphEdge => Boolean(e))}
            familyId={familyId}
            onRemove={handleRemoveEdge}
          />
        ) : (
          <EdgeDetail
            edge={edges.find((e) => e.id === selection.edgeIds[0]) ?? null}
            familyId={familyId}
          />
        )}
      </div>
    </div>
  );
}

const TX_KIND_LABEL: Record<string, string> = {
  draft: "Draft pick",
  trade: "Trade",
  waiver: "Waiver",
  free_agent: "Free agent",
  commissioner: "Commissioner",
};

function NodeDetail({
  node,
  transactions,
  familyId,
}: {
  node: GraphNode | null;
  transactions: Record<string, EnrichedTransaction>;
  familyId: string;
}) {
  if (!node) {
    return <p className="text-sm text-muted-foreground">Node not found.</p>;
  }

  if (node.kind === "current_roster") {
    return (
      <div className="space-y-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Current roster
          </p>
          <p className="text-sm font-semibold">{node.displayName}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Assets currently held by this manager. Each incoming stint is a player
          or pick still on this manager&apos;s roster.
        </p>
      </div>
    );
  }

  // transaction node
  if (node.transactionId && transactions[node.transactionId]) {
    return <TransactionCard tx={toTransactionData(transactions[node.transactionId])} familyId={familyId} />;
  }

  // draft transaction (no transactionId — render summary from node data)
  const firstAsset = node.assets[0];
  return (
    <div className="space-y-3 border rounded-lg p-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {TX_KIND_LABEL[node.txKind] ?? node.txKind}
      </p>
      {node.managers.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground">Manager</p>
          <p className="text-sm font-semibold">
            {node.managers.map((m) => m.displayName).join(" · ")}
          </p>
        </div>
      )}
      {firstAsset && firstAsset.kind === "player" && (
        <div>
          <p className="text-xs text-muted-foreground">Player</p>
          <p className="text-sm">
            {firstAsset.playerPosition ? `${firstAsset.playerPosition} · ` : ""}
            {firstAsset.playerName}
          </p>
          {firstAsset.playerId && (
            <Link
              href={`/league/${familyId}/player/${encodeURIComponent(firstAsset.playerId)}`}
              className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
            >
              Open player
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
      {firstAsset && firstAsset.kind === "pick" && (
        <div>
          <p className="text-xs text-muted-foreground">Pick</p>
          <p className="text-sm">{firstAsset.pickLabel}</p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {node.season}
        {node.week ? ` · Week ${node.week}` : ""}
      </p>
    </div>
  );
}

function EdgeDetail({ edge, familyId }: { edge: GraphEdge | null; familyId: string }) {
  if (!edge) {
    return <p className="text-sm text-muted-foreground">Edge not found.</p>;
  }
  const endLabel = edge.isOpen
    ? "Ongoing"
    : `${edge.endSeason ?? ""}${edge.endWeek ? ` · W${edge.endWeek}` : ""}`;

  return (
    <div className="space-y-3 border rounded-lg p-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {edge.isOpen ? "Active stint" : "Stint"}
      </p>
      {edge.assetKind === "player" ? (
        <div>
          <p className="text-xs text-muted-foreground">Player</p>
          <p className="text-sm font-semibold">
            {edge.playerPosition ? `${edge.playerPosition} · ` : ""}
            {edge.playerName}
          </p>
          {edge.playerId && (
            <Link
              href={`/league/${familyId}/player/${encodeURIComponent(edge.playerId)}`}
              className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
            >
              Open player
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          )}
        </div>
      ) : (
        <div>
          <p className="text-xs text-muted-foreground">Pick</p>
          <p className="text-sm font-semibold">{edge.pickLabel}</p>
        </div>
      )}
      <div>
        <p className="text-xs text-muted-foreground">Manager</p>
        <p className="text-sm">{edge.managerName}</p>
      </div>
      {edge.assetKind === "player" && edge.playerId && (
        <PlayerStintStats familyId={familyId} edge={edge} />
      )}
      <p className="text-xs text-muted-foreground">
        {edge.startSeason} W{edge.startWeek} → {endLabel}
      </p>
      {edge.assetKind === "player" && edge.playerId && (
        <p className="text-[11px] tip-shimmer pt-1 border-t border-border/40">
          Tip: <kbd className="font-mono">⌘</kbd>-click another stint to compare.
        </p>
      )}
    </div>
  );
}

interface StintStatsResponse {
  ppg: number | null;
  ppgStarting: number | null;
  startPct: number | null;
  activePct: number | null;
  weeksAvailable: number;
  weeksActive: number;
  starterWeeks: number;
}

type StintStatsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; data: StintStatsResponse };

function buildStintStatsUrl(familyId: string, edge: GraphEdge): string | null {
  if (!edge.playerId) return null;
  const sp = new URLSearchParams({
    managerUserId: edge.managerUserId,
    startSeason: edge.startSeason,
    startWeek: String(edge.startWeek),
  });
  if (edge.endSeason) sp.set("endSeason", edge.endSeason);
  if (edge.endWeek != null) sp.set("endWeek", String(edge.endWeek));
  return `/api/leagues/${familyId}/player/${encodeURIComponent(edge.playerId)}/stint-stats?${sp.toString()}`;
}

function useStintStats(familyId: string, edge: GraphEdge): StintStatsState {
  const [state, setState] = useState<StintStatsState>({ status: "loading" });
  const url = buildStintStatsUrl(familyId, edge);
  useEffect(() => {
    if (!url) {
      setState({ status: "error" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: StintStatsResponse) => {
        if (!cancelled) setState({ status: "ok", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}

function PlayerStintStats({
  familyId,
  edge,
}: {
  familyId: string;
  edge: GraphEdge;
}) {
  const state = useStintStats(familyId, edge);

  if (state.status === "loading") {
    return (
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (state.status === "error" || state.data.weeksActive === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No active scoring weeks recorded for this stint.
      </p>
    );
  }

  const stats = state.data;
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1.5">Stint stats</p>
      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label="PPG"
          value={fmtNumber(stats.ppg)}
          hint={`${stats.weeksActive} wk${stats.weeksActive === 1 ? "" : "s"}`}
        />
        <StatTile
          label="PPG starting"
          value={fmtNumber(stats.ppgStarting)}
          hint={`${stats.starterWeeks} wk${stats.starterWeeks === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Start %"
          value={fmtPercent(stats.startPct)}
          hint={`${stats.starterWeeks}/${stats.weeksActive}`}
        />
        <StatTile
          label="Active %"
          value={fmtPercent(stats.activePct)}
          hint={`${stats.weeksActive}/${stats.weeksAvailable}`}
        />
      </div>
    </div>
  );
}

const COMPARE_METRIC_ROWS = [
  {
    label: "PPG",
    raw: (s: StintStatsResponse) => s.ppg,
    value: (s: StintStatsResponse) => fmtNumber(s.ppg),
    hint: (s: StintStatsResponse) =>
      `${s.weeksActive} wk${s.weeksActive === 1 ? "" : "s"}`,
  },
  {
    label: "PPG starting",
    raw: (s: StintStatsResponse) => s.ppgStarting,
    value: (s: StintStatsResponse) => fmtNumber(s.ppgStarting),
    hint: (s: StintStatsResponse) =>
      `${s.starterWeeks} wk${s.starterWeeks === 1 ? "" : "s"}`,
  },
  {
    label: "Start %",
    raw: (s: StintStatsResponse) => s.startPct,
    value: (s: StintStatsResponse) => fmtPercent(s.startPct),
    hint: (s: StintStatsResponse) => `${s.starterWeeks}/${s.weeksActive}`,
  },
  {
    label: "Active %",
    raw: (s: StintStatsResponse) => s.activePct,
    value: (s: StintStatsResponse) => fmtPercent(s.activePct),
    hint: (s: StintStatsResponse) => `${s.weeksActive}/${s.weeksAvailable}`,
  },
] as const;

function useStintStatsByEdge(
  familyId: string,
  edges: GraphEdge[],
): Map<string, StintStatsState> {
  const [results, setResults] = useState<Map<string, StintStatsState>>(
    () => new Map(),
  );
  const urlByEdge = edges
    .map((e) => `${e.id}|${buildStintStatsUrl(familyId, e) ?? ""}`)
    .join("\n");

  useEffect(() => {
    let cancelled = false;
    const next = new Map<string, StintStatsState>();
    for (const edge of edges) {
      next.set(edge.id, { status: "loading" });
    }
    setResults(next);

    edges.forEach((edge) => {
      const url = buildStintStatsUrl(familyId, edge);
      if (!url) {
        setResults((prev) => {
          const m = new Map(prev);
          m.set(edge.id, { status: "error" });
          return m;
        });
        return;
      }
      fetch(url)
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((data: StintStatsResponse) => {
          if (cancelled) return;
          setResults((prev) => {
            const m = new Map(prev);
            m.set(edge.id, { status: "ok", data });
            return m;
          });
        })
        .catch(() => {
          if (cancelled) return;
          setResults((prev) => {
            const m = new Map(prev);
            m.set(edge.id, { status: "error" });
            return m;
          });
        });
    });

    return () => {
      cancelled = true;
    };
  }, [urlByEdge]); // eslint-disable-line react-hooks/exhaustive-deps

  return results;
}

function EdgeCompare({
  edges,
  familyId,
  onRemove,
}: {
  edges: GraphEdge[];
  familyId: string;
  onRemove?: (edgeId: string) => void;
}) {
  const statsByEdge = useStintStatsByEdge(familyId, edges);
  const leadersByRow = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const row of COMPARE_METRIC_ROWS) {
      const candidates: Array<{ id: string; value: number }> = [];
      for (const edge of edges) {
        const state = statsByEdge.get(edge.id);
        if (state?.status !== "ok") continue;
        if (state.data.weeksActive === 0) continue;
        const raw = row.raw(state.data);
        if (raw == null) continue;
        candidates.push({ id: edge.id, value: raw });
      }
      if (candidates.length < 2) continue;
      const max = Math.max(...candidates.map((c) => c.value));
      map.set(
        row.label,
        new Set(candidates.filter((c) => c.value === max).map((c) => c.id)),
      );
    }
    return map;
  }, [edges, statsByEdge]);
  if (edges.length === 0) {
    return <p className="text-sm text-muted-foreground">No stints to compare.</p>;
  }
  const colTemplate = `100px repeat(${edges.length}, minmax(120px, 1fr))`;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto -mx-4 px-4">
        <div className="min-w-max space-y-2">
          <div
            className="grid gap-2 items-stretch"
            style={{ gridTemplateColumns: colTemplate }}
          >
            <div />
            {edges.map((edge) => (
              <CompareColumnHeader
                key={edge.id}
                edge={edge}
                familyId={familyId}
                onRemove={onRemove}
              />
            ))}
          </div>

          {COMPARE_METRIC_ROWS.map((row) => (
            <div
              key={row.label}
              className="grid gap-2 items-center"
              style={{ gridTemplateColumns: colTemplate }}
            >
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {row.label}
              </p>
              {edges.map((edge) => (
                <CompareCell
                  key={edge.id}
                  edge={edge}
                  state={statsByEdge.get(edge.id) ?? { status: "loading" }}
                  row={row}
                  isLeader={leadersByRow.get(row.label)?.has(edge.id) ?? false}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="text-[11px] tip-shimmer">
        Tip: <kbd className="font-mono">⌘</kbd>-click an edge to add or remove it from this comparison.
      </p>
    </div>
  );
}

function CompareColumnHeader({
  edge,
  familyId,
  onRemove,
}: {
  edge: GraphEdge;
  familyId: string;
  onRemove?: (edgeId: string) => void;
}) {
  const endLabel = edge.isOpen
    ? "Ongoing"
    : `${edge.endSeason ?? ""}${edge.endWeek ? ` W${edge.endWeek}` : ""}`;
  const isPlayer = edge.assetKind === "player";
  return (
    <div className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs space-y-0.5 relative">
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(edge.id)}
          className="absolute top-1 right-1 inline-flex items-center justify-center h-5 w-5 rounded hover:bg-accent hover:text-accent-foreground"
          aria-label="Remove from comparison"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {isPlayer ? (
        <Link
          href={
            edge.playerId
              ? `/league/${familyId}/player/${encodeURIComponent(edge.playerId)}`
              : "#"
          }
          className="block pr-5 font-semibold leading-tight hover:underline"
        >
          {edge.playerPosition ? `${edge.playerPosition} · ` : ""}
          {edge.playerName}
        </Link>
      ) : (
        <p className="pr-5 font-semibold leading-tight">{edge.pickLabel}</p>
      )}
      <p className="text-muted-foreground truncate">{edge.managerName}</p>
      <p className="font-mono text-[10px] text-muted-foreground">
        {edge.startSeason} W{edge.startWeek} → {endLabel}
      </p>
    </div>
  );
}

function CompareCell({
  edge,
  state,
  row,
  isLeader,
}: {
  edge: GraphEdge;
  state: StintStatsState;
  row: (typeof COMPARE_METRIC_ROWS)[number];
  isLeader: boolean;
}) {
  const isPlayer = edge.assetKind === "player" && Boolean(edge.playerId);

  if (!isPlayer) {
    return (
      <div className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-center">
        <p className="font-mono text-base font-semibold text-muted-foreground leading-tight">
          —
        </p>
        <p className="font-mono text-[10px] text-muted-foreground">pick</p>
      </div>
    );
  }
  if (state.status === "loading") {
    return <div className="h-12 rounded-md bg-muted animate-pulse" />;
  }
  if (state.status === "error" || state.data.weeksActive === 0) {
    return (
      <div className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-center">
        <p className="font-mono text-base font-semibold text-muted-foreground leading-tight">
          —
        </p>
      </div>
    );
  }
  const containerClass = isLeader
    ? "rounded-md border border-primary/40 bg-primary/5 px-2 py-1.5 text-center"
    : "rounded-md border border-border/60 bg-background px-2 py-1.5 text-center";
  const valueClass = isLeader
    ? "font-mono text-base font-semibold text-primary leading-tight"
    : "font-mono text-base font-semibold text-foreground leading-tight";
  return (
    <div className={containerClass} aria-label={isLeader ? "Top value" : undefined}>
      <p className={valueClass}>{row.value(state.data)}</p>
      <p className="font-mono text-[10px] text-muted-foreground">
        {row.hint(state.data)}
      </p>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-mono text-base font-semibold text-foreground leading-tight">
        {value}
      </p>
      <p className="font-mono text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function fmtNumber(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(1);
}

function fmtPercent(n: number | null): string {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

export default GraphDetailDrawer;
