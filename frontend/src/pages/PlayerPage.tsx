import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { User, Calendar, GitBranch, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../services/api';
import { TransactionTreeVisualization } from '../components/visualizations/TransactionTreeVisualization';
import { transformTransactionGraphToD3, calculateOptimalSize } from '../utils/treeTransformers';
import { TreeData, LayoutType } from '../types/visualization';

interface PlayerData {
  id: string;
  name: string;
  position: string;
  team: string;
  totalTrades: number;
}

export function PlayerPage() {
  const { playerId } = useParams<{ playerId: string }>();
  const [playerData, setPlayerData] = useState<PlayerData | null>(null);
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // For now, we'll use a test league ID - this should come from context or route
  const TEST_LEAGUE_ID = '1191596293294166016';

  useEffect(() => {
    const fetchPlayerData = async () => {
      if (!playerId) return;

      setLoading(true);
      setError(null);

      try {
        // For now, let's use the transaction graph and find our player
        const response = await api.getTransactionGraph(TEST_LEAGUE_ID, { format: 'json' });
        
        // Find the player in the graph nodes (response.graph.nodes is an array)
        let playerAsset = null;
        for (const asset of response.graph.nodes) {
          if (asset.id === playerId && asset.type === 'player') {
            playerAsset = asset;
            break;
          }
        }
        
        if (!playerAsset) {
          throw new Error('Player not found in transaction graph');
        }

        // Count transactions involving this player
        const playerTransactions = response.graph.transactions.filter((txn: any) => 
          txn.assetsReceived.some((a: any) => a.id === playerId) || 
          txn.assetsGiven.some((a: any) => a.id === playerId)
        );

        // Set player data
        setPlayerData({
          id: playerAsset.id,
          name: playerAsset.name || 'Unknown Player',
          position: playerAsset.position || 'Unknown',
          team: playerAsset.team || 'Unknown',
          totalTrades: playerTransactions.length
        });

        // Convert arrays to Maps for the transformer
        const graphWithMaps = {
          nodes: new Map(response.graph.nodes.map((node: any) => [node.id, node])),
          edges: new Map(), // We'll skip edges for now
          chains: new Map(response.graph.transactions.map((txn: any) => [txn.id, txn]))
        };

        // Transform graph data for D3 visualization  
        const d3TreeData = transformTransactionGraphToD3(graphWithMaps);
        setTreeData(d3TreeData);

      } catch (err) {
        console.error('Failed to fetch player data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load player data');
      } finally {
        setLoading(false);
      }
    };

    fetchPlayerData();
  }, [playerId]);

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
          Player Transaction Chain
        </h1>
        <p className="text-gray-600">
          Player ID: {playerId}
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        <div className="card">
          <div className="flex items-center">
            <User className="h-8 w-8 text-blue-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Player Name</h3>
              <p className="text-gray-600">{playerData?.name || '-'}</p>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="flex items-center">
            <Calendar className="h-8 w-8 text-blue-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Position & Team</h3>
              <p className="text-gray-600">
                {playerData ? `${playerData.position} - ${playerData.team}` : '-'}
              </p>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="flex items-center">
            <GitBranch className="h-8 w-8 text-blue-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Total Trades</h3>
              <p className="text-gray-600">{playerData?.totalTrades || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {treeData && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-900">Transaction Chain Visualization</h2>
            <div className="text-sm text-gray-600">
              {treeData.nodes.length} nodes, {treeData.links.length} connections
            </div>
          </div>
          
          <div className="overflow-x-auto">
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
          
          <div className="mt-4 flex gap-4 text-xs text-gray-600">
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
        </div>
      )}
    </div>
  );
}