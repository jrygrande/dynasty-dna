import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { User, Calendar, GitBranch, Loader2, AlertCircle, Activity, BarChart3, Network } from 'lucide-react';
import { api } from '../services/api';
import { TransactionTreeVisualization } from '../components/visualizations/TransactionTreeVisualization';
import { TransactionTimeline } from '../components/visualizations/TransactionTimeline';
import { TransactionMultiTrackTimeline } from '../components/visualizations/TransactionMultiTrackTimeline';
import { transformTransactionGraphToD3, calculateOptimalSize } from '../utils/treeTransformers';
import { TreeData, LayoutType } from '../types/visualization';


export function PlayerPage() {
  const { playerId } = useParams<{ playerId: string }>();
  const [playerData, setPlayerData] = useState<{
    player: { id: string; name: string; position?: string; team?: string; };
    transactions: any[];
    totalTransactions: number;
  } | null>(null);
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'network' | 'timeline' | 'multitrack'>('multitrack');

  // For now, we'll use a test league ID - this should come from context or route
  const TEST_LEAGUE_ID = '1191596293294166016';

  useEffect(() => {
    const fetchPlayerData = async () => {
      if (!playerId) return;

      setLoading(true);
      setError(null);

      try {
        console.log(`🎯 Fetching asset history for player ${playerId}`);
        
        // Use the simple asset-history endpoint that only returns direct transactions
        const response = await api.getAssetHistory(playerId, TEST_LEAGUE_ID);
        
        // Extract player info from the first transaction or create a basic one
        const playerInfo = response.transactions.length > 0 
          ? {
              id: playerId,
              name: response.transactions[0].assetsReceived.find((asset: any) => asset.id === playerId)?.name ||
                    response.transactions[0].assetsGiven.find((asset: any) => asset.id === playerId)?.name ||
                    'Unknown Player',
              position: response.transactions[0].assetsReceived.find((asset: any) => asset.id === playerId)?.position ||
                       response.transactions[0].assetsGiven.find((asset: any) => asset.id === playerId)?.position,
              team: response.transactions[0].assetsReceived.find((asset: any) => asset.id === playerId)?.team ||
                   response.transactions[0].assetsGiven.find((asset: any) => asset.id === playerId)?.team
            }
          : { id: playerId, name: 'Unknown Player' };

        setPlayerData({
          player: playerInfo,
          transactions: response.transactions,
          totalTransactions: response.totalTransactions
        });

        // Still create tree data for network view if needed
        if (response.transactions.length > 0) {
          const d3TreeData = transformPlayerDataToD3(response.transactions, playerId);
          setTreeData(d3TreeData);
        }

      } catch (err) {
        console.error('Failed to fetch player data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load player data');
      } finally {
        setLoading(false);
      }
    };

    fetchPlayerData();
  }, [playerId]);

  // Transform player transaction data to D3 format (simplified for network view)
  const transformPlayerDataToD3 = (transactions: any[], focalPlayerId: string): TreeData => {
    const nodes = new Set<any>();
    const links: any[] = [];

    // Add focal player node
    const focalAsset = transactions[0]?.assetsReceived?.find((asset: any) => asset.id === focalPlayerId) ||
                      transactions[0]?.assetsGiven?.find((asset: any) => asset.id === focalPlayerId);
    
    if (focalAsset) {
      nodes.add({
        id: focalAsset.id,
        name: focalAsset.name,
        type: focalAsset.type,
        depth: 0,
        importance: 1.0,
        position: focalAsset.position,
        team: focalAsset.team
      });
    }

    // Add assets from direct transactions
    transactions.forEach(transaction => {
      [...transaction.assetsReceived, ...transaction.assetsGiven].forEach(asset => {
        if (asset.id !== focalPlayerId) {
          nodes.add({
            id: asset.id,
            name: asset.name,
            type: asset.type,
            depth: 1,
            importance: 0.8,
            position: asset.position,
            team: asset.team
          });
          
          // Create link
          links.push({
            source: focalPlayerId,
            target: asset.id,
            transactionId: transaction.id,
            depth: 1
          });
        }
      });
    });

    return { 
      nodes: Array.from(nodes), 
      links 
    };
  };

  const handleNodeClick = (node: any) => {
    console.log('Node clicked:', node);
    // TODO: Implement node selection/expansion logic
  };

  // Handle fetching asset history for multi-track timeline
  const handleFetchAssetHistory = async (assetId: string) => {
    try {
      const response = await api.getAssetHistory(assetId, TEST_LEAGUE_ID);
      return response.transactions;
    } catch (error) {
      console.error('Failed to fetch asset history:', error);
      throw error;
    }
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
          {playerData?.player?.name || `Player ID: ${playerId}`}
        </p>
      </div>

      <div className="grid lg:grid-cols-4 gap-6 mb-8">
        <div className="card">
          <div className="flex items-center">
            <User className="h-8 w-8 text-blue-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Player Name</h3>
              <p className="text-gray-600">{playerData?.player?.name || '-'}</p>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="flex items-center">
            <Calendar className="h-8 w-8 text-blue-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Position & Team</h3>
              <p className="text-gray-600">
                {playerData?.player ? 
                  `${playerData.player.position || 'N/A'} - ${playerData.player.team || 'N/A'}` : 
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
                {playerData?.totalTransactions || 0} transactions
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
                {treeData?.nodes.length || 0} assets
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Panel */}
      {playerData && (
        <div className="card mb-8">
          <h4 className="text-lg font-semibold text-gray-900 mb-4">Player Statistics</h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-lg font-bold text-blue-600">
                {playerData.transactions.length}
              </div>
              <div className="text-xs text-gray-500">Direct Transactions</div>
            </div>
            
            <div className="text-center">
              <div className="text-lg font-bold text-blue-600">
                {new Set(playerData.transactions.map(t => t.type)).size}
              </div>
              <div className="text-xs text-gray-500">Transaction Types</div>
            </div>
            
            <div className="text-center">
              <div className="text-lg font-bold text-blue-600">
                {treeData?.nodes.length || 0}
              </div>
              <div className="text-xs text-gray-500">Connected Assets</div>
            </div>
            
            <div className="text-center">
              <div className="text-lg font-bold text-blue-600">
                {new Set(playerData.transactions.map(t => t.season)).size}
              </div>
              <div className="text-xs text-gray-500">Seasons Active</div>
            </div>
          </div>
        </div>
      )}

      {playerData && (
        <div className="card">
          {/* View Toggle */}
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center space-x-4">
              <h2 className="text-xl font-bold text-gray-900">Transaction History</h2>
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('multitrack')}
                  className={`flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    viewMode === 'multitrack'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <BarChart3 className="h-4 w-4 mr-1.5" />
                  Multi-Track
                </button>
                <button
                  onClick={() => setViewMode('timeline')}
                  className={`flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    viewMode === 'timeline'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Calendar className="h-4 w-4 mr-1.5" />
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
              {playerData.totalTransactions} transactions
            </div>
          </div>

          {/* Multi-Track Timeline View */}
          {viewMode === 'multitrack' && (
            <TransactionMultiTrackTimeline
              focalPlayerTransactions={playerData.transactions}
              focalPlayerName={playerData.player.name}
              focalPlayerId={playerData.player.id}
              onFetchAssetHistory={handleFetchAssetHistory}
              className="multi-track-timeline-view"
            />
          )}

          {/* Simple Timeline View */}
          {viewMode === 'timeline' && (
            <TransactionTimeline
              transactions={playerData.transactions}
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