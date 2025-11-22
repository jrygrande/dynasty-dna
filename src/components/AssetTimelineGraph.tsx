'use client';

import { useCallback, useState, useMemo } from 'react';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    Node,
    Edge,
    useNodesState,
    useEdgesState,
    addEdge,
    Connection,
    NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';

import type { PlayerTimelineResponse, TimelineAsset, TimelineEvent } from '@/lib/api/assets';
import TransactionNode from '@/components/graph/TransactionNode';
import AssetNode from '@/components/graph/AssetNode';
import TransactionDetailsModal from '@/components/TransactionDetailsModal';
import {
    buildGraphFromTimelines,
    calculateNodePositions,
    getAssetId,
    type GraphNode,
    type GraphEdge,
    type TransactionNodeData,
    type AssetNodeData,
} from '@/lib/utils/graph';

interface AssetTimelineGraphProps {
    initialTimeline: {
        data: PlayerTimelineResponse;
        conflicts?: any;
    };
    leagueId: string;
}

interface TimelineData {
    assetId: string;
    data: PlayerTimelineResponse;
}

export default function AssetTimelineGraph({ initialTimeline, leagueId }: AssetTimelineGraphProps) {
    // State for managing loaded timelines
    const [timelines, setTimelines] = useState<TimelineData[]>([
        {
            assetId: `player-${initialTimeline.data.player.id}`,
            data: initialTimeline.data,
        },
    ]);

    // State for modal
    const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Build graph from timelines
    const graphData = useMemo(() => {
        const graph = buildGraphFromTimelines(timelines);
        return calculateNodePositions(graph);
    }, [timelines]);

    // Convert graph data to React Flow format
    const initialNodes: Node[] = graphData.nodes.map((node: GraphNode) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        data: node.data,
    }));

    const initialEdges: Edge[] = graphData.edges.map((edge: GraphEdge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        animated: true,
    }));

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    // Update nodes and edges when graph data changes
    useMemo(() => {
        const newNodes: Node[] = graphData.nodes.map((node: GraphNode) => ({
            id: node.id,
            type: node.type,
            position: node.position,
            data: node.data,
        }));

        const newEdges: Edge[] = graphData.edges.map((edge: GraphEdge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            type: 'smoothstep',
            animated: true,
        }));

        setNodes(newNodes);
        setEdges(newEdges);
    }, [graphData, setNodes, setEdges]);

    // Handle node clicks
    const onNodeClick = useCallback(
        (event: React.MouseEvent, node: Node) => {
            if (node.type === 'transaction') {
                const txData = node.data as TransactionNodeData;
                setSelectedEvent(txData.event);
                setIsModalOpen(true);
            }
        },
        []
    );

    // Handle asset clicks from modal
    const handleAssetClick = useCallback(
        async (asset: TimelineAsset) => {
            const assetId = getAssetId(asset);

            // Check if timeline already loaded
            if (timelines.find(t => t.assetId === assetId)) {
                // Already loaded, just highlight it
                return;
            }

            // Load timeline for this asset
            try {
                const url =
                    asset.assetKind === 'player'
                        ? `/api/assets/timeline/player?leagueId=${leagueId}&playerId=${asset.playerId}`
                        : `/api/assets/timeline/pick?leagueId=${leagueId}&season=${asset.pickSeason}&round=${asset.pickRound}&originalRosterId=${asset.pickOriginalRosterId}`;

                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to load timeline: ${response.statusText}`);
                }

                const data = await response.json();
                if (!data.ok) {
                    throw new Error(data.error || 'Failed to load timeline');
                }

                // Add to timelines
                setTimelines(prev => [...prev, { assetId, data }]);
            } catch (error) {
                console.error('Failed to load asset timeline:', error);
                // TODO: Show error toast
            }
        },
        [leagueId, timelines]
    );

    // Define custom node types
    const nodeTypes: NodeTypes = useMemo(
        () => ({
            transaction: TransactionNode,
            asset: AssetNode,
        }),
        []
    );

    return (
        <div className="w-full h-screen">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.1}
                maxZoom={2}
            >
                <Background />
                <Controls />
                <MiniMap
                    nodeColor={(node) => {
                        if (node.type === 'transaction') return '#3b82f6';
                        return '#10b981';
                    }}
                />
            </ReactFlow>

            {/* Transaction Details Modal */}
            <TransactionDetailsModal
                event={selectedEvent}
                isOpen={isModalOpen}
                onOpenChange={setIsModalOpen}
                onAssetClick={handleAssetClick}
            />
        </div>
    );
}
