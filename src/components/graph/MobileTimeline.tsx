"use client";

import { Fragment, useEffect, useMemo } from "react";
import { ArrowDown } from "lucide-react";

import type {
  GraphEdge,
  GraphFocus,
  GraphResponse,
  TransactionNode,
} from "@/lib/assetGraph";
import { useGraphVisibility, edgeAssetKey } from "@/lib/useGraphVisibility";
import { trackEvent } from "@/lib/analytics";

import { AssetPicker } from "./AssetPicker";
import { ManagerName } from "@/components/ManagerName";
import {
  TransactionCardChrome,
  type TransactionCardChromeData,
  type TransactionNodeAsset,
} from "./TransactionCardChrome";
import { buildTransactionHeader, isHeaderExpanded } from "./transactionHeader";

// Tailwind needs literal class strings to ship the underlying CSS, so we
// pre-enumerate every chart-N class the rail might use rather than building
// them via template literals.
const RAIL_LINE_CLASSES = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
  "bg-chart-6",
] as const;
const RAIL_LINE_PASSTHROUGH_CLASSES = [
  "bg-chart-1/20",
  "bg-chart-2/20",
  "bg-chart-3/20",
  "bg-chart-4/20",
  "bg-chart-5/20",
  "bg-chart-6/20",
] as const;
const THREAD_DOT_CLASSES = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
  "bg-chart-6",
] as const;

type ThreadColorMap = Map<string, number>; // assetKey → palette index 0..5

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
    <div className="bg-background">
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

  // Stable thread ordering by first appearance across the chronological list.
  // The corresponding palette index (0..5) is assigned in this order so a
  // given thread keeps the same color as the user expands more of the graph.
  const threadKeys = useMemo<string[]>(() => {
    const seen: string[] = [];
    const seenSet = new Set<string>();
    for (const node of nodes) {
      const keys = chainAssetsByNode.get(node.id);
      if (!keys) continue;
      for (const k of keys) {
        if (seenSet.has(k)) continue;
        seenSet.add(k);
        seen.push(k);
      }
    }
    return seen;
  }, [nodes, chainAssetsByNode]);

  const threadColorMap = useMemo<ThreadColorMap>(() => {
    const m = new Map<string, number>();
    threadKeys.forEach((k, i) => m.set(k, i % 6));
    return m;
  }, [threadKeys]);

  // Single-thread (or no-thread) graphs keep the existing layout — no rail.
  const showRail = threadKeys.length >= 2;

  if (!showRail) {
    return (
      <div className="flex flex-col items-stretch">
        {nodes.map((node, idx) => {
          const prev = idx > 0 ? nodes[idx - 1] : null;
          return (
            <div key={node.id}>
              {prev && <Connector from={prev} to={node} edges={edges} threadColorMap={threadColorMap} showThreadColor={false} />}
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

  // Rail width: 4px per thread + a small gap, capped reasonably. Each thread
  // gets a 2px hairline with 2px breathing room.
  const railWidth = `${Math.max(threadKeys.length * 6, 12)}px`;

  return (
    <div
      className="grid gap-x-2"
      style={{ gridTemplateColumns: `${railWidth} 1fr` }}
    >
      {nodes.map((node, idx) => {
        const prev = idx > 0 ? nodes[idx - 1] : null;
        const activeThreads = chainAssetsByNode.get(node.id) ?? new Set();
        return (
          <Fragment key={node.id}>
            {prev && (
              <>
                <RailSegment
                  threadKeys={threadKeys}
                  activeThreads={chainAssetsByNode.get(prev.id) ?? new Set()}
                  threadColorMap={threadColorMap}
                  variant="connector"
                />
                <Connector
                  from={prev}
                  to={node}
                  edges={edges}
                  threadColorMap={threadColorMap}
                  showThreadColor={true}
                />
              </>
            )}
            <RailSegment
              threadKeys={threadKeys}
              activeThreads={activeThreads}
              threadColorMap={threadColorMap}
              variant="card"
            />
            <div className="min-w-0">
              <MobileCard
                node={node}
                chainAssetKeys={activeThreads}
                expandedAssets={nodeExpandedAssets.get(node.id) ?? new Set()}
                fullyExpanded={fullyExpanded}
                isSelected={selectedNodeId === node.id}
                onAssetClick={onAssetClick}
                onHeaderToggle={onHeaderToggle}
                onSelect={onSelect}
              />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function RailSegment({
  threadKeys,
  activeThreads,
  threadColorMap,
  variant,
}: {
  threadKeys: string[];
  activeThreads: Set<string>;
  threadColorMap: ThreadColorMap;
  variant: "card" | "connector";
}) {
  // Each thread is a vertical hairline. Active = full-color saturation; passthrough = faded.
  return (
    <div
      className={
        variant === "card"
          ? "flex items-stretch justify-around py-1"
          : "flex items-stretch justify-around"
      }
      aria-hidden="true"
    >
      {threadKeys.map((key) => {
        const color = threadColorMap.get(key) ?? 0;
        const active = activeThreads.has(key);
        const cls = active ? RAIL_LINE_CLASSES[color] : RAIL_LINE_PASSTHROUGH_CLASSES[color];
        return <div key={key} className={`w-0.5 ${cls}`} />;
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
  threadColorMap,
  showThreadColor,
}: {
  from: TransactionNode;
  to: TransactionNode;
  edges: GraphEdge[];
  threadColorMap: ThreadColorMap;
  showThreadColor: boolean;
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
          {bracketing.map((edge) => {
            const key = edgeAssetKey(edge);
            const colorIdx = key ? threadColorMap.get(key) : undefined;
            return (
              <div key={edge.id} className="flex items-center gap-1">
                {showThreadColor && colorIdx !== undefined && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${THREAD_DOT_CLASSES[colorIdx]}`}
                    aria-hidden="true"
                  />
                )}
                <span className="font-mono">{edgeAssetLabel(edge)}</span>
                <span aria-hidden>·</span>
                <ManagerName
                  userId={edge.managerUserId}
                  displayName={edge.managerName}
                  variant="display-only"
                />
              </div>
            );
          })}
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
