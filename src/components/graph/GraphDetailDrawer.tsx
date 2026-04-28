"use client";

import { useEffect, useRef, useState } from "react";
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
  variant = "drawer",
}: GraphDetailDrawerProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selection.type === "node") {
      const node = nodes.find((n) => n.id === selection.nodeId);
      trackEvent("graph_node_selected", { kind: node?.kind ?? "unknown" });
    } else {
      const edge = edges.find((e) => e.id === selection.edgeId);
      trackEvent("graph_edge_selected", {
        assetKind: edge?.assetKind ?? "unknown",
        isOpen: edge?.isOpen ?? false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.type, selection.type === "node" ? selection.nodeId : selection.edgeId]);

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

  const containerClass =
    variant === "sheet"
      ? "fixed inset-0 bg-card overflow-y-auto z-50"
      : "absolute top-0 right-0 bottom-0 w-96 bg-card border-l border-border/60 shadow-lg overflow-y-auto z-10";

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
        <h2 className="font-serif text-base text-sage-800">Details</h2>
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
        ) : (
          <EdgeDetail
            edge={edges.find((e) => e.id === selection.edgeId) ?? null}
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

function PlayerStintStats({
  familyId,
  edge,
}: {
  familyId: string;
  edge: GraphEdge;
}) {
  const [stats, setStats] = useState<StintStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!edge.playerId) return;
    let cancelled = false;
    setLoading(true);
    setError(false);

    const sp = new URLSearchParams({
      managerUserId: edge.managerUserId,
      startSeason: edge.startSeason,
      startWeek: String(edge.startWeek),
    });
    if (edge.endSeason) sp.set("endSeason", edge.endSeason);
    if (edge.endWeek != null) sp.set("endWeek", String(edge.endWeek));

    fetch(
      `/api/leagues/${familyId}/player/${encodeURIComponent(edge.playerId)}/stint-stats?${sp.toString()}`,
    )
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: StintStatsResponse) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    familyId,
    edge.playerId,
    edge.managerUserId,
    edge.startSeason,
    edge.startWeek,
    edge.endSeason,
    edge.endWeek,
  ]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (error || !stats || stats.weeksActive === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No active scoring weeks recorded for this stint.
      </p>
    );
  }

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
