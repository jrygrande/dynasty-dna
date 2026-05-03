"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft } from "lucide-react";

import type {
  GraphEdge,
  GraphFocus,
  GraphResponse,
  TransactionNode,
} from "@/lib/assetGraph";
import { useGraphVisibility, edgeAssetKey } from "@/lib/useGraphVisibility";
import { trackEvent } from "@/lib/analytics";

import { AssetPicker } from "./AssetPicker";
import { CopyLinkButton } from "./CopyLinkButton";
import { ManagerName } from "@/components/ManagerName";
import {
  TransactionCardChrome,
  type TransactionCardChromeData,
  type TransactionNodeAsset,
} from "./TransactionCardChrome";
import { buildTransactionHeader, isHeaderExpanded } from "./transactionHeader";

interface MobileTimelineProps {
  familyId: string;
  response: GraphResponse | null;
  loading: boolean;
  seed: string[];
  expanded: Set<string>;
  fullyExpanded: Set<string>;
  selectedNodeId: string | null;
  seedAssetKey: string | undefined;
  onPickerSelect: (focus: GraphFocus) => void;
  onAssetClick: (nodeId: string, assetKey: string) => void;
  onHeaderToggle: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
  onReset: () => void;
}

const EMPTY_REMOVED: Set<string> = new Set();

/**
 * Mobile-friendly vertical timeline rendition of the asset graph.
 *
 * Reuses the same chain-thread state model as desktop (seed, expanded,
 * fullyExpanded, seedAssetKey) and renders visible transaction nodes as a
 * vertical chronological stack of <TransactionCardChrome /> cards. No React
 * Flow on mobile — the cards are plain divs with connector strips between
 * them showing the bracketing tenure edge labels.
 */
export function MobileTimeline({
  familyId,
  response,
  loading,
  seed,
  expanded,
  fullyExpanded,
  selectedNodeId,
  seedAssetKey,
  onPickerSelect,
  onAssetClick,
  onHeaderToggle,
  onSelect,
  onReset,
}: MobileTimelineProps) {
  useEffect(() => {
    trackEvent("graph_mobile_timeline_opened", { familyId });
  }, [familyId]);

  const graph = useMemo(
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

  const sortedTxNodes = useMemo<TransactionNode[]>(() => {
    return visibility.visibleNodes
      .filter((n): n is TransactionNode => n.kind === "transaction")
      .slice()
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        if (a.season !== b.season) return a.season.localeCompare(b.season);
        return a.week - b.week;
      });
  }, [visibility.visibleNodes]);

  const hasSeed = seed.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 border-b bg-background px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/league/${familyId}`}
            className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            League
          </Link>
          <h1 className="text-base font-semibold flex-1 truncate">
            Trade network digest
          </h1>
          <CopyLinkButton hasFocus={hasSeed} />
        </div>
        {hasSeed && (
          <div className="mt-2">
            <button
              type="button"
              onClick={onReset}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      <div className="p-4">
        {loading && !response && <TimelineSkeleton />}

        {!loading && !response && (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load the graph. Try again later.
          </p>
        )}

        {!loading && response && !hasSeed && (
          <div className="min-h-[60vh]">
            <AssetPicker familyId={familyId} onPick={onPickerSelect} />
          </div>
        )}

        {hasSeed && response && sortedTxNodes.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">
            No transactions in this thread yet.
          </p>
        )}

        {hasSeed && sortedTxNodes.length > 0 && (
          <Timeline
            nodes={sortedTxNodes}
            edges={visibility.visibleEdges}
            chainAssetsByNode={visibility.chainAssetsByNode}
            expanded={expanded}
            fullyExpanded={fullyExpanded}
            selectedNodeId={selectedNodeId}
            onAssetClick={onAssetClick}
            onHeaderToggle={onHeaderToggle}
            onSelect={onSelect}
          />
        )}
      </div>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-24 rounded-md border bg-muted/30 animate-pulse"
        />
      ))}
    </div>
  );
}

function Timeline({
  nodes,
  edges,
  chainAssetsByNode,
  expanded,
  fullyExpanded,
  selectedNodeId,
  onAssetClick,
  onHeaderToggle,
  onSelect,
}: {
  nodes: TransactionNode[];
  edges: GraphEdge[];
  chainAssetsByNode: Map<string, Set<string>>;
  expanded: Set<string>;
  fullyExpanded: Set<string>;
  selectedNodeId: string | null;
  onAssetClick: (nodeId: string, assetKey: string) => void;
  onHeaderToggle: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
}) {
  // For each visible node, the set of asset keys expanded at it. Includes
  // direct expansions (nodeId~assetKey entries) plus every edge endpoint
  // sharing an expanded asset key — mirrors AssetGraph's behavior so the
  // card renders the same "checked +" state.
  const nodeExpandedAssets = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const expandedAssetKeys = new Set<string>();
    for (const entry of expanded) {
      const sep = entry.indexOf("~");
      if (sep === -1) continue;
      const assetKey = entry.slice(sep + 1);
      expandedAssetKeys.add(assetKey);
      addToBucket(m, entry.slice(0, sep), assetKey);
    }
    for (const e of edges) {
      const k = edgeAssetKey(e);
      if (!k || !expandedAssetKeys.has(k)) continue;
      addToBucket(m, e.source, k);
      addToBucket(m, e.target, k);
    }
    return m;
  }, [expanded, edges]);

  return (
    <div className="flex flex-col items-stretch">
      {nodes.map((node, idx) => {
        const prev = idx > 0 ? nodes[idx - 1] : null;
        return (
          <div key={node.id}>
            {prev && (
              <Connector
                from={prev}
                to={node}
                edges={edges}
              />
            )}
            <div className="flex justify-center">
              <MobileCard
                node={node}
                chainAssetKeys={chainAssetsByNode.get(node.id) ?? new Set()}
                expandedAssets={nodeExpandedAssets.get(node.id) ?? new Set()}
                fullyExpanded={fullyExpanded}
                isSelected={selectedNodeId === node.id}
                onAssetClick={onAssetClick}
                onHeaderToggle={onHeaderToggle}
                onSelect={onSelect}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MobileCard({
  node,
  chainAssetKeys,
  expandedAssets,
  fullyExpanded,
  isSelected,
  onAssetClick,
  onHeaderToggle,
  onSelect,
}: {
  node: TransactionNode;
  chainAssetKeys: Set<string>;
  expandedAssets: Set<string>;
  fullyExpanded: Set<string>;
  isSelected: boolean;
  onAssetClick: (nodeId: string, assetKey: string) => void;
  onHeaderToggle: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
}) {
  const header = buildTransactionHeader(node);
  const headerExpanded = isHeaderExpanded(node, fullyExpanded);
  const dimmed = chainAssetKeys.size === 0 && !headerExpanded;

  const nameByUser = new Map(
    node.managers.map((m) => [m.userId, m.displayName]),
  );

  const assets: TransactionNodeAsset[] = node.assets.map((a) => {
    const toName = a.toUserId ? nameByUser.get(a.toUserId) ?? null : null;
    if (a.kind === "player") {
      const name = a.playerName ?? a.playerId ?? "Player";
      return {
        kind: "player",
        assetKey: `player:${a.playerId}`,
        label: name,
        position: a.playerPosition ?? null,
        toUserId: a.toUserId,
        toName,
        fromUserId: a.fromUserId,
      };
    }
    const label = a.pickLabel ?? `${a.pickSeason} R${a.pickRound}`;
    return {
      kind: "pick",
      assetKey: `pick:${a.pickSeason}:${a.pickRound}:${a.pickOriginalRosterId}`,
      label,
      toUserId: a.toUserId,
      toName,
      fromUserId: a.fromUserId,
    };
  });

  const data: TransactionCardChromeData = {
    txKind: node.txKind,
    header,
    managers: node.managers,
    assets,
    expandedAssets,
    chainAssetKeys,
    headerExpanded,
    selected: isSelected,
    dimmed,
    onAssetClick,
    onHeaderToggle,
    onSelect,
  };

  return (
    <TransactionCardChrome
      nodeId={node.id}
      data={data}
      isSelected={isSelected}
      hoveredAssetKey={null}
      onAssetHover={noop}
      handles={null}
      renderAssetHandles={renderNoHandles}
    />
  );
}

function Connector({
  from,
  to,
  edges,
}: {
  from: TransactionNode;
  to: TransactionNode;
  edges: GraphEdge[];
}) {
  const bracketing = edges.filter(
    (e) =>
      (e.source === from.id && e.target === to.id) ||
      (e.source === to.id && e.target === from.id),
  );

  return (
    <div className="flex flex-col items-center py-1">
      <div className="h-3 w-px bg-border" aria-hidden="true" />
      {bracketing.length > 0 ? (
        <div className="flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] text-muted-foreground">
          {bracketing.map((edge) => (
            <div key={edge.id} className="flex items-center gap-1">
              <span className="font-mono">{edgeAssetLabel(edge)}</span>
              <span aria-hidden>·</span>
              <ManagerName
                userId={edge.managerUserId}
                displayName={edge.managerName}
                variant="display-only"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="px-2 py-1 text-[10px] italic text-muted-foreground inline-flex items-center gap-1">
          <ArrowDown className="h-3 w-3" />
          thread continues
        </div>
      )}
      <div className="h-3 w-px bg-border" aria-hidden="true" />
    </div>
  );
}

function edgeAssetLabel(edge: GraphEdge): string {
  if (edge.assetKind === "player") return edge.playerName ?? "Player";
  return edge.pickLabel ?? `${edge.pickSeason ?? ""} R${edge.pickRound ?? ""}`;
}

function addToBucket(map: Map<string, Set<string>>, key: string, value: string) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

function noop() {}
function renderNoHandles() {
  return null;
}

export default MobileTimeline;
