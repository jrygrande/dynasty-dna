import { buildGraphFromTimelines } from '@/lib/utils/graph';

// Mock Enriched Transaction
const mockEnrichedTx = {
    id: 'tx-1',
    leagueId: 'league-1',
    type: 'trade',
    status: 'complete',
    timestamp: new Date().toISOString(),
    managers: [],
    assets: [
        { kind: 'player', id: 'player-1', name: 'Player One', fromRosterId: 1, toRosterId: 2 },
        { kind: 'pick', id: 'pick-2024-1-1', name: '2024 Round 1', fromRosterId: 2, toRosterId: 1 }
    ],
    metadata: {}
};

// Mock Timeline Data
const mockData = {
    family: [],
    player: { id: 'player-1', name: 'Player One', position: 'RB', team: 'NFL', status: 'Active' },
    events: [],
    timeline: [], // Empty legacy timeline
    enrichedTransactions: [mockEnrichedTx]
};

async function test() {
    console.log('Testing buildGraphFromTimelines with enriched transactions...');

    const graph = buildGraphFromTimelines([
        { assetId: 'player-player-1', data: mockData as any }
    ]);

    console.log('Nodes:', graph.nodes.length);
    console.log('Edges:', graph.edges.length);

    const txNode = graph.nodes.find(n => n.type === 'transaction');
    if (txNode) {
        console.log('Transaction Node Found:', txNode.id);
        console.log('Asset IDs in Tx:', (txNode.data as any).assetIds);
    } else {
        console.error('Transaction Node NOT Found!');
    }

    const assetNode = graph.nodes.find(n => n.type === 'asset');
    if (assetNode) {
        console.log('Asset Node Found:', assetNode.id);
    }
}

test().catch(console.error);
