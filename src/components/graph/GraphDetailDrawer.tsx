"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import type {
  GraphEdge,
  GraphNode,
  GraphSelection,
} from "@/lib/assetGraph";
import type { EnrichedTransaction } from "@/lib/transactionEnrichment";
import { TransactionCard, type TransactionData } from "@/components/TransactionCard";
import { trackEvent } from "@/lib/analytics";

/** Adapt `EnrichedTransaction` (null) to `TransactionData` (optional). */
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
}

function getRoundSuffix(round: number): string {
  if (round === 1) return "st";
  if (round === 2) return "nd";
  if (round === 3) return "rd";
  return "th";
}

export function GraphDetailDrawer({
  selection,
  nodes,
  edges,
  transactions,
  familyId,
  onClose,
}: GraphDetailDrawerProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Analytics: fire once on mount for this selection.
  useEffect(() => {
    if (selection.type === "node") {
      const node = nodes.find((n) => n.id === selection.nodeId);
      trackEvent("graph_node_selected", { kind: node?.kind ?? "unknown" });
    } else {
      const edge = edges.find((e) => e.id === selection.edgeId);
      trackEvent("graph_edge_selected", {
        kind: edge?.kind ?? "unknown",
        hasTransactionId: Boolean(edge?.transactionId),
      });
    }
    // Only fire when the selection identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.type, selection.type === "node" ? selection.nodeId : selection.edgeId]);

  // Keyboard: Esc closes. Focus trap within the drawer.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
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
    // Focus the close button on open.
    closeBtnRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label="Graph detail"
      className="absolute top-0 right-0 bottom-0 w-96 bg-card border-l shadow-lg overflow-y-auto z-10"
    >
      <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b bg-card">
        <h2 className="text-sm font-semibold">Details</h2>
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
            familyId={familyId}
          />
        ) : (
          <EdgeDetail
            edge={edges.find((e) => e.id === selection.edgeId) ?? null}
            transactions={transactions}
            nodes={nodes}
            familyId={familyId}
          />
        )}
      </div>
    </div>
  );
}

function NodeDetail({ node, familyId }: { node: GraphNode | null; familyId: string }) {
  if (!node) {
    return <p className="text-sm text-muted-foreground">Node not found.</p>;
  }

  if (node.kind === "manager") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          {node.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={node.avatar}
              alt=""
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <div className="h-10 w-10 rounded-full bg-muted" aria-hidden />
          )}
          <div>
            <p className="text-sm font-semibold">{node.displayName}</p>
            <p className="text-xs text-muted-foreground">Manager</p>
          </div>
        </div>
        {node.seasons.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">Seasons</p>
            <div className="flex flex-wrap gap-1">
              {node.seasons.map((s) => (
                <span
                  key={s}
                  className="px-1.5 py-0.5 text-xs rounded-md bg-muted text-muted-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}
        {typeof node.tradeCount === "number" && (
          <p className="text-xs text-muted-foreground">
            {node.tradeCount} trade{node.tradeCount === 1 ? "" : "s"}
          </p>
        )}
      </div>
    );
  }

  if (node.kind === "player") {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold">{node.name}</p>
          <p className="text-xs text-muted-foreground">
            {node.position ?? "—"}
            {node.team ? ` · ${node.team}` : ""}
          </p>
        </div>
        <Link
          href={`/league/${familyId}/timeline?playerId=${encodeURIComponent(node.playerId)}`}
          className="inline-block text-xs text-primary hover:underline"
        >
          View full timeline &rarr;
        </Link>
      </div>
    );
  }

  // pick
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">
          {node.pickSeason} R{node.pickRound}
          {node.pickRound ? (
            <span className="text-muted-foreground font-normal">
              {" "}
              ({node.pickRound}
              {getRoundSuffix(node.pickRound)} round)
            </span>
          ) : null}
        </p>
        {node.pickOriginalOwnerName && (
          <p className="text-xs text-muted-foreground">
            Original owner: {node.pickOriginalOwnerName}
          </p>
        )}
      </div>
      {node.resolvedPlayerId && node.resolvedPlayerName && (
        <Link
          href={`/league/${familyId}/timeline?playerId=${encodeURIComponent(node.resolvedPlayerId)}`}
          className="inline-block text-xs text-primary hover:underline"
        >
          Drafted: {node.resolvedPlayerName} &rarr;
        </Link>
      )}
    </div>
  );
}

function EdgeDetail({
  edge,
  transactions,
  nodes,
  familyId,
}: {
  edge: GraphEdge | null;
  transactions: Record<string, EnrichedTransaction>;
  nodes: GraphNode[];
  familyId: string;
}) {
  if (!edge) {
    return <p className="text-sm text-muted-foreground">Edge not found.</p>;
  }

  const tx = edge.transactionId ? transactions[edge.transactionId] : null;
  if (tx) {
    return <TransactionCard tx={toTransactionData(tx)} familyId={familyId} />;
  }

  // Draft pick / draft selected fallback — no backing transaction.
  const sourceNode = nodes.find((n) => n.id === edge.source) ?? null;
  const targetNode = nodes.find((n) => n.id === edge.target) ?? null;
  return (
    <div className="space-y-2 border rounded-lg p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {edge.kind.replace(/_/g, " ")}
      </p>
      <p className="text-sm">
        {describeNode(sourceNode)} &rarr; {describeNode(targetNode)}
      </p>
      <p className="text-xs text-muted-foreground">
        {edge.season}
        {edge.week ? ` · Week ${edge.week}` : ""}
      </p>
    </div>
  );
}

function describeNode(n: GraphNode | null): string {
  if (!n) return "—";
  if (n.kind === "manager") return n.displayName;
  if (n.kind === "player") return n.name;
  return `${n.pickSeason} R${n.pickRound}`;
}

export default GraphDetailDrawer;
