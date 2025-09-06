import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { User, Calendar, GitBranch, Loader2, AlertCircle, Settings, Activity, BarChart3, Network } from 'lucide-react';
import { api } from '../services/api';
import { TransactionTreeVisualization } from '../components/visualizations/TransactionTreeVisualization';
import { TransactionTimeline } from '../components/visualizations/TransactionTimeline';
import { transformTransactionGraphToD3, calculateOptimalSize } from '../utils/treeTransformers';
import { TreeData, LayoutType } from '../types/visualization';

interface PlayerNetworkData {
  focalPlayer: {
    id: string;
    name: string;
    position?: string;
    team?: string;
  };
  network: {
    nodes: Array<{
      id: string;
      type: 'player' | 'draft_pick';
      name: string;
      position?: string;
      team?: string;
      depth: number;
      importance: number;
    }>;
    transactions: Array<{
      id: string;
      type: string;
      description: string;
      timestamp: string;
      season: string;
      assetsReceived: any[];
      assetsGiven: any[];
      managerFrom?: { id: string; username: string; displayName?: string; };
      managerTo?: { id: string; username: string; displayName?: string; };
    }>;
    connections: Array<{
      fromAsset: string;
      toAsset: string;
      transactionId: string;
      depth: number;
    }>;
  };
  stats: {
    totalNodes: number;
    totalTransactions: number;
    depthDistribution: Record<number, number>;
    transactionTypes: Record<string, number>;
    buildTimeMs: number;
  };
}

export function PlayerPage() {
  const { playerId } = useParams<{ playerId: string }>();
  const [playerNetworkData, setPlayerNetworkData] = useState<PlayerNetworkData | null>(null);
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [networkDepth, setNetworkDepth] = useState(2);
  const [viewMode, setViewMode] = useState<'network' | 'timeline'>('timeline');

  // For now, we'll use a test league ID - this should come from context or route
  const TEST_LEAGUE_ID = '1191596293294166016';

  // Depth labels for the slider
  const depthLabels: Record<number, string> = {
    1: 'Direct Transactions',
    2: 'One Degree Out',
    3: 'Two Degrees Out',
    4: 'Three Degrees Out',
    5: 'Four Degrees Out'
  };

  useEffect(() => {
    const fetchPlayerNetworkData = async () => {
      if (!playerId) return;

      setLoading(true);
      setError(null);

      try {
        console.log(`🎯 Fetching player network for ${playerId} with depth ${networkDepth}`);
        
        // Use the new optimized player network endpoint
        const response = await api.getPlayerNetwork(TEST_LEAGUE_ID, playerId, {
          depth: networkDepth,
          includeStats: true
        });
        
        setPlayerNetworkData({
          focalPlayer: response.focalPlayer,
          network: response.network,
          stats: response.stats
        });

        // Convert to D3 format for visualization
        const d3TreeData = transformPlayerNetworkToD3(response.network);
        setTreeData(d3TreeData);

      } catch (err) {
        console.error('Failed to fetch player network data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load player network data');
      } finally {
        setLoading(false);
      }
    };

    fetchPlayerNetworkData();
  }, [playerId, networkDepth]);

  // Transform player network data to D3 format
  const transformPlayerNetworkToD3 = (network: PlayerNetworkData['network']): TreeData => {
    const nodes = network.nodes.map(node => ({
      id: node.id,
      name: node.name,
      type: node.type,
      depth: node.depth,
      importance: node.importance,
      position: node.position,
      team: node.team
    }));

    const links = network.connections.map(conn => ({
      source: conn.fromAsset,
      target: conn.toAsset,
      transactionId: conn.transactionId,
      depth: conn.depth
    }));

    return { nodes, links };
  };

  const handleNodeClick = (node: any) => {
    console.log('Node clicked:', node);
    // TODO: Implement node selection/expansion logic
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading player transaction data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-4" />
          <p className="text-red-600 mb-2">Failed to load player data</p>
          <p className="text-gray-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const optimalSize = treeData ? calculateOptimalSize(treeData) : { width: 800, height: 600 };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Player Transaction Network
        </h1>
        <p className="text-gray-600">
          {playerNetworkData?.focalPlayer?.name || `Player ID: ${playerId}`}
        </p>
      </div>

      <div className="grid lg:grid-cols-4 gap-6 mb-8">
        <div className="card">
          <div className="flex items-center">
            <User className="h-8 w-8 text-blue-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Player Name</h3>
              <p className="text-gray-600">{playerNetworkData?.focalPlayer?.name || '-'}</p>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="flex items-center">
            <Calendar className="h-8 w-8 text-blue-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Position & Team</h3>
              <p className="text-gray-600">
                {playerNetworkData?.focalPlayer ? 
                  `${playerNetworkData.focalPlayer.position || 'N/A'} - ${playerNetworkData.focalPlayer.team || 'N/A'}` : 
                  '-'
                }
              </p>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="flex items-center">
            <GitBranch className="h-8 w-8 text-blue-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Network Size</h3>
              <p className="text-gray-600">
                {playerNetworkData?.stats?.totalTransactions || 0} transactions
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <Activity className="h-8 w-8 text-blue-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Total Assets</h3>
              <p className="text-gray-600">
                {playerNetworkData?.stats?.totalNodes || 0} assets
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Network Depth Control */}
      <div className="card mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Settings className="h-6 w-6 text-blue-600 mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Network Depth</h3>
          </div>
          <div className="text-sm text-gray-600">
            {depthLabels[networkDepth]}
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-500">1</span>
          <input
            type="range"
            min="1"
            max="5"
            value={networkDepth}
            onChange={(e) => setNetworkDepth(parseInt(e.target.value))}
            className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-sm text-gray-500">5</span>
        </div>
        
        <div className="flex justify-between text-xs text-gray-500 mt-2">
          {Object.entries(depthLabels).map(([depth, label]) => (
            <span key={depth} className={networkDepth === parseInt(depth) ? 'text-blue-600 font-medium' : ''}>
              {label}
            </span>
          ))}
        </div>

        {/* Stats Panel */}
        {playerNetworkData && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Network Statistics</h4>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-lg font-bold text-blue-600">
                  {playerNetworkData.stats.buildTimeMs}ms
                </div>
                <div className="text-xs text-gray-500">Query Time</div>
              </div>
              
              <div className="text-center">
                <div className="text-lg font-bold text-blue-600">
                  {Object.keys(playerNetworkData.stats.transactionTypes).length}
                </div>
                <div className="text-xs text-gray-500">Transaction Types</div>
              </div>
              
              <div className="text-center">
                <div className="text-lg font-bold text-blue-600">
                  {Object.values(playerNetworkData.stats.depthDistribution).reduce((a, b) => a + b, 0)}
                </div>
                <div className="text-xs text-gray-500">Connected Assets</div>
              </div>
              
              <div className="text-center">
                <div className="text-lg font-bold text-blue-600">
                  {networkDepth}
                </div>
                <div className="text-xs text-gray-500">Current Depth</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {playerNetworkData && (
        <div className="card">
          {/* View Toggle */}
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center space-x-4">
              <h2 className="text-xl font-bold text-gray-900">Transaction History</h2>
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('timeline')}
                  className={`flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    viewMode === 'timeline'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <BarChart3 className="h-4 w-4 mr-1.5" />
                  Timeline
                </button>
                <button
                  onClick={() => setViewMode('network')}
                  className={`flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    viewMode === 'network'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Network className="h-4 w-4 mr-1.5" />
                  Network
                </button>
              </div>
            </div>
            <div className="text-sm text-gray-600">
              {playerNetworkData.stats.totalTransactions} transactions across {Object.keys(playerNetworkData.stats.depthDistribution).length} degrees
            </div>
          </div>

          {/* Timeline View */}
          {viewMode === 'timeline' && (
            <TransactionTimeline
              transactions={playerNetworkData.network.transactions}
              className="transaction-timeline-view"
            />
          )}

          {/* Network View */}
          {viewMode === 'network' && treeData && (
            <>
              <div className="overflow-x-auto mb-4">
                <TransactionTreeVisualization
                  data={treeData}
                  config={{
                    width: optimalSize.width,
                    height: optimalSize.height,
                    layout: LayoutType.FORCE_DIRECTED,
                    enableZoom: true,
                    enableDrag: true,
                    showTooltips: true
                  }}
                  onNodeClick={handleNodeClick}
                  className="mx-auto"
                />
              </div>
              
              <div className="flex gap-4 text-xs text-gray-600">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                  <span>Players</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <span>Draft Picks</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-indigo-500"></div>
                  <span>Trades</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                  <span>Waivers</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}