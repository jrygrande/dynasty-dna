import type { PlayerTimelineResponse, TimelineEvent, TimelineAsset } from '@/lib/api/assets';

export interface GraphNode {
    id: string;
    type: 'transaction' | 'asset';
    data: TransactionNodeData | AssetNodeData;
    position: { x: number; y: number };
}

export interface TransactionNodeData {
    transactionId: string | null;
    eventType: string;
    eventTime: string | null;
    season: string | null;
    week: number | null;
    assetIds: string[];  // IDs of assets involved
    event: TimelineEvent;
}

export interface AssetNodeData {
    assetId: string;  // Unique: player-{id} or pick-{season}-{round}-{rosterId}
    assetKind: 'player' | 'pick';
    name: string;
    position?: string | null;
    team?: string | null;
    transactionIds: string[];  // IDs of transactions this asset is involved in
    timeline: TimelineEvent[];
}

export interface GraphEdge {
    id: string;
    source: string;  // node ID
    target: string;  // node ID
    type: 'asset-to-transaction';
}

export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

/**
 * Generate a unique asset ID from asset information
 */
export function getAssetId(asset: TimelineAsset | { assetKind: string; playerId?: string | null; pickSeason?: string | null; pickRound?: number | null; pickOriginalRosterId?: number | null }): string {
    if (asset.assetKind === 'player') {
        return `player-${asset.playerId}`;
    } else {
        return `pick-${asset.pickSeason}-${asset.pickRound}-${asset.pickOriginalRosterId}`;
    }
}

/**
 * Generate a unique transaction ID
 */
export function getTransactionId(event: TimelineEvent): string {
    // Use the actual transaction ID if available, otherwise create a synthetic one
    if (event.transactionId) {
        return `tx-${event.transactionId}`;
    }
    // For non-transaction events (like drafts), use the event ID
    return `event-${event.id}`;
}

/**
 * Get asset name for display
 */
export function getAssetName(asset: TimelineAsset | AssetNodeData): string {
    if ('name' in asset && asset.name) {
        return asset.name;
    }

    if (asset.assetKind === 'player') {
        const playerAsset = asset as TimelineAsset;
        return playerAsset.playerName || `Player ${playerAsset.playerId}`;
    } else {
        const pickAsset = asset as TimelineAsset;
        return `${pickAsset.pickSeason} R${pickAsset.pickRound} Pick`;
    }
}

/**
 * Build graph data from multiple timelines
 * Deduplicates transactions that appear in multiple asset timelines
 */
export function buildGraphFromTimelines(
    timelines: Array<{ assetId: string; data: PlayerTimelineResponse }>
): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const transactionNodeMap = new Map<string, GraphNode>();
    const assetNodeMap = new Map<string, GraphNode>();

    let yOffset = 0;
    const LANE_HEIGHT = 300;
    const NODE_SPACING = 200;

    // Process each timeline
    for (const { assetId, data } of timelines) {
        // Check if we have enriched transactions
        if (data.enrichedTransactions && data.enrichedTransactions.length > 0) {
            // Use enriched transactions
            const enrichedTxs = data.enrichedTransactions;

            // Create asset node if not exists
            if (!assetNodeMap.has(assetId)) {
                assetNodeMap.set(assetId, {
                    id: assetId,
                    type: 'asset',
                    data: {
                        assetId,
                        assetKind: assetId.startsWith('player-') ? 'player' : 'pick',
                        name: data.player.name,
                        position: data.player.position,
                        team: data.player.team,
                        transactionIds: [],
                        timeline: [], // We might want to populate this for the modal
                    },
                    position: { x: 0, y: yOffset },
                });
            }

            let xOffset = NODE_SPACING;

            for (const tx of enrichedTxs) {
                const txId = `tx-${tx.id}`;

                // Create transaction node if not exists
                let transactionNode = transactionNodeMap.get(txId);
                if (!transactionNode) {
                    const assetIds = tx.assets.map(a => {
                        if (a.kind === 'player') return `player-${a.id}`;
                        return a.id;
                    });

                    // Extract managers for the event
                    // Build user objects from managers for the grouping function
                    const userObjects = tx.managers.map(m => ({
                        id: m.userId || `roster-${m.rosterId}`,
                        username: null,
                        displayName: m.displayName
                    }));

                    // For trades, we need fromUser and toUser to initialize the user map
                    // Use the first two managers (trades typically have 2 parties)
                    const fromUser = userObjects[0] || null;
                    const toUser = userObjects[1] || null;
                    const fromRosterId = tx.managers[0]?.rosterId || null;
                    const toRosterId = tx.managers[1]?.rosterId || null;

                    transactionNode = {
                        id: txId,
                        type: 'transaction',
                        data: {
                            transactionId: tx.id,
                            eventType: tx.type,
                            eventTime: tx.timestamp,
                            season: null, // Enriched tx doesn't have explicit season yet
                            week: null,
                            assetIds,
                            event: { // Mock event for modal compatibility
                                id: tx.id,
                                leagueId: tx.leagueId,
                                eventType: tx.type,
                                eventTime: tx.timestamp,
                                season: null,
                                week: null,
                                fromRosterId: fromRosterId,
                                toRosterId: toRosterId,
                                fromUser: fromUser,
                                toUser: toUser,
                                details: tx.metadata,
                                transactionId: tx.id,
                                assetsInTransaction: tx.assets.map(a => ({
                                    id: a.id,
                                    assetKind: a.kind,
                                    eventType: 'trade', // generic
                                    playerId: a.kind === 'player' ? a.id : undefined,
                                    playerName: a.name,
                                    pickSeason: a.kind === 'pick' ? a.id.split('-')[1] : undefined,
                                    pickRound: a.kind === 'pick' ? parseInt(a.id.split('-')[2]) : undefined,
                                    pickOriginalRosterId: a.kind === 'pick' ? parseInt(a.id.split('-')[3]) : undefined,
                                    fromRosterId: a.fromRosterId,
                                    toRosterId: a.toRosterId,
                                    fromUserId: a.fromUserId, // Explicitly add for helper functions
                                    toUserId: a.toUserId,     // Explicitly add for helper functions
                                    fromUser: a.fromUserId ? { id: a.fromUserId, username: null, displayName: null } : null,
                                    toUser: a.toUserId ? { id: a.toUserId, username: null, displayName: null } : null,
                                }))
                            } as any
                        },
                        position: { x: xOffset, y: yOffset + 100 },
                    };
                    transactionNodeMap.set(txId, transactionNode);
                }

                // Link asset to transaction
                const assetNode = assetNodeMap.get(assetId);
                if (assetNode) {
                    const assetData = assetNode.data as AssetNodeData;
                    if (!assetData.transactionIds.includes(txId)) {
                        assetData.transactionIds.push(txId);
                    }

                    const txData = transactionNode.data as TransactionNodeData;
                    if (!txData.assetIds.includes(assetId)) {
                        txData.assetIds.push(assetId);
                    }

                    const edgeId = `${assetId}-${txId}`;
                    if (!edges.find(e => e.id === edgeId)) {
                        edges.push({
                            id: edgeId,
                            source: assetId,
                            target: txId,
                            type: 'asset-to-transaction',
                        });
                    }
                }

                xOffset += NODE_SPACING;
            }
            yOffset += LANE_HEIGHT;
            continue; // Skip legacy processing for this timeline
        }

        // Legacy processing (fallback)
        // Filter out events we don't want to show in the graph
        const filteredEvents = data.timeline.filter(event => {
            // Remove season_continuation events (these are synthetic for performance tracking)
            if (event.eventType === 'season_continuation') {
                return false;
            }

            // For transactions with multiple event types (add/drop/trade), only show the primary event
            // If there's a 'trade' or 'pick_trade' event for this transaction, filter out add/drop
            if (event.transactionId && (event.eventType === 'add' || event.eventType === 'drop')) {
                const hasTradeEvent = data.timeline.some(
                    e => e.transactionId === event.transactionId &&
                        (e.eventType === 'trade' || e.eventType === 'pick_trade')
                );
                if (hasTradeEvent) {
                    return false;
                }
            }

            return true;
        });

        // Create asset node
        const assetNode: GraphNode = {
            id: assetId,
            type: 'asset',
            data: {
                assetId,
                assetKind: assetId.startsWith('player-') ? 'player' : 'pick',
                name: data.player.name,
                position: data.player.position,
                team: data.player.team,
                transactionIds: [],
                timeline: filteredEvents,
            },
            position: { x: 0, y: yOffset },
        };

        assetNodeMap.set(assetId, assetNode);

        // Process events in this timeline
        let xOffset = NODE_SPACING;
        for (const event of filteredEvents) {
            const txId = getTransactionId(event);

            // Check if transaction node already exists (deduplication)
            let transactionNode = transactionNodeMap.get(txId);

            if (!transactionNode) {
                // Create new transaction node
                const assetIds: string[] = [];

                // Add assets from this event
                if (event.assetsInTransaction && event.assetsInTransaction.length > 0) {
                    for (const asset of event.assetsInTransaction) {
                        assetIds.push(getAssetId(asset));
                    }
                }

                transactionNode = {
                    id: txId,
                    type: 'transaction',
                    data: {
                        transactionId: event.transactionId,
                        eventType: event.eventType,
                        eventTime: event.eventTime,
                        season: event.season,
                        week: event.week,
                        assetIds,
                        event,
                    },
                    position: { x: xOffset, y: yOffset + 100 },
                };

                transactionNodeMap.set(txId, transactionNode);
            }

            // Add this asset to the transaction's asset list if not already there
            const txData = transactionNode.data as TransactionNodeData;
            if (!txData.assetIds.includes(assetId)) {
                txData.assetIds.push(assetId);
            }

            // Add this transaction to the asset's transaction list
            const assetData = assetNode.data as AssetNodeData;
            if (!assetData.transactionIds.includes(txId)) {
                assetData.transactionIds.push(txId);
            }

            // Create edge from asset to transaction
            const edgeId = `${assetId}-${txId}`;
            if (!edges.find(e => e.id === edgeId)) {
                edges.push({
                    id: edgeId,
                    source: assetId,
                    target: txId,
                    type: 'asset-to-transaction',
                });
            }

            xOffset += NODE_SPACING;
        }

        yOffset += LANE_HEIGHT;
    }

    // Convert maps to arrays
    nodes.push(...assetNodeMap.values());
    nodes.push(...transactionNodeMap.values());

    return { nodes, edges };
}

/**
 * Calculate optimized node positions using a chronological layout
 */
export function calculateNodePositions(graphData: GraphData): GraphData {
    const { nodes, edges } = graphData;

    // Group nodes by type
    const assetNodes = nodes.filter(n => n.type === 'asset');
    const transactionNodes = nodes.filter(n => n.type === 'transaction');

    // Sort transactions chronologically
    transactionNodes.sort((a, b) => {
        const dataA = a.data as TransactionNodeData;
        const dataB = b.data as TransactionNodeData;

        const seasonA = parseInt(dataA.season || '0');
        const seasonB = parseInt(dataB.season || '0');
        if (seasonA !== seasonB) return seasonA - seasonB;

        const weekA = dataA.week || 0;
        const weekB = dataB.week || 0;
        if (weekA !== weekB) return weekA - weekB;

        // Use event time as tiebreaker
        if (dataA.eventTime && dataB.eventTime) {
            return new Date(dataA.eventTime).getTime() - new Date(dataB.eventTime).getTime();
        }

        return 0;
    });

    // Assign x positions to transactions based on chronological order
    const NODE_SPACING_X = 250;
    const NODE_SPACING_Y = 200;
    const START_X = 100;
    const START_Y = 100;

    transactionNodes.forEach((node, index) => {
        node.position = {
            x: START_X + index * NODE_SPACING_X,
            y: START_Y + 300, // Transactions in the middle
        };
    });

    // Position asset nodes in lanes
    assetNodes.forEach((node, index) => {
        node.position = {
            x: START_X - 100, // Assets on the left
            y: START_Y + index * NODE_SPACING_Y,
        };
    });

    return { nodes, edges };
}

/**
 * Find all assets connected to a transaction
 */
export function findConnectedAssets(
    transactionId: string,
    graphData: GraphData
): AssetNodeData[] {
    const transactionNode = graphData.nodes.find(
        n => n.id === transactionId && n.type === 'transaction'
    );

    if (!transactionNode) return [];

    const txData = transactionNode.data as TransactionNodeData;
    const assetNodes = graphData.nodes.filter(
        n => n.type === 'asset' && txData.assetIds.includes(n.id)
    );

    return assetNodes.map(n => n.data as AssetNodeData);
}
