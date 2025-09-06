import { 
  D3Node, 
  D3Link, 
  TreeData, 
  NodeType, 
  TransactionType
} from '../types/visualization';
import { 
  TransactionNode, 
  AssetNode, 
  AssetTradeTree, 
  TransactionGraph 
} from '../types/api';

/**
 * Transform a backend TransactionNode to a D3Node
 */
export function transformTransactionToD3Node(transaction: TransactionNode): D3Node {
  return {
    id: transaction.id,
    type: NodeType.TRANSACTION,
    name: `${transaction.type} - Week ${transaction.week}`,
    transactionType: transaction.type as TransactionType,
    timestamp: transaction.timestamp,
    description: transaction.description,
    participants: [
      transaction.managerFrom?.username || 'Unknown',
      transaction.managerTo?.username || 'Unknown'
    ].filter(Boolean),
    radius: 8, // Smaller radius for transaction nodes
    expanded: false
  };
}

/**
 * Transform a backend AssetNode to a D3Node
 */
export function transformAssetToD3Node(asset: AssetNode): D3Node {
  const isPlayer = asset.type === 'player';
  
  return {
    id: asset.id,
    type: isPlayer ? NodeType.PLAYER : NodeType.DRAFT_PICK,
    name: asset.name || (isPlayer ? 'Unknown Player' : `${asset.season} R${asset.round}`),
    
    // Player-specific fields
    position: isPlayer ? (asset.position || undefined) : undefined,
    team: isPlayer ? (asset.team || undefined) : undefined,
    sleeperId: asset.sleeperId,
    
    // Draft pick-specific fields
    season: !isPlayer ? asset.season : undefined,
    round: !isPlayer ? asset.round : undefined,
    pickNumber: !isPlayer ? (asset.pickNumber || undefined) : undefined,
    originalOwner: !isPlayer ? asset.originalOwnerId : undefined,
    currentOwner: !isPlayer ? asset.currentOwnerId : undefined,
    
    radius: isPlayer ? 16 : 12,
    expanded: false,
    children: []
  };
}

/**
 * Transform an AssetTradeTree to TreeData for D3 visualization
 */
export function transformAssetTradeTreeToD3(tree: AssetTradeTree): TreeData {
  const nodes: D3Node[] = [];
  const links: D3Link[] = [];
  
  // Add the root asset
  const rootNode = transformAssetToD3Node(tree.rootAsset);
  rootNode.x = 400; // Center horizontally
  rootNode.y = 50;  // Start at top
  nodes.push(rootNode);
  
  let yOffset = 150;
  let nodeCounter = 0;
  
  // Add transaction nodes and their connections
  tree.transactionPath.forEach((transaction, index) => {
    const transactionNode = transformTransactionToD3Node(transaction);
    transactionNode.x = 400;
    transactionNode.y = yOffset + (index * 100);
    nodes.push(transactionNode);
    
    // Link from previous node to this transaction
    const previousNodeId = index === 0 ? rootNode.id : nodes[nodes.length - 2].id;
    links.push({
      id: `link-${nodeCounter++}`,
      source: previousNodeId,
      target: transactionNode.id,
      transactionId: transaction.id,
      transactionType: transaction.type as TransactionType,
      timestamp: transaction.timestamp,
      description: transaction.description
    });
    
    // Add assets involved in this transaction
    let assetXOffset = 200;
    [...transaction.assetsReceived, ...transaction.assetsGiven].forEach((asset, assetIndex) => {
      // Skip if this asset is already the root
      if (asset.id === tree.rootAsset.id) return;
      
      const assetNode = transformAssetToD3Node(asset);
      assetNode.x = 100 + (assetXOffset * assetIndex);
      assetNode.y = transactionNode.y;
      nodes.push(assetNode);
      
      // Link transaction to asset
      links.push({
        id: `link-${nodeCounter++}`,
        source: transactionNode.id,
        target: assetNode.id,
        transactionId: transaction.id,
        transactionType: transaction.type as TransactionType
      });
    });
    
    yOffset += 150;
  });
  
  // Add derived assets (recursive)
  tree.derivedAssets.forEach((derivedTree, index) => {
    const derivedData = transformAssetTradeTreeToD3(derivedTree);
    
    // Offset derived tree nodes
    const xOffset = 600 + (index * 300);
    derivedData.nodes.forEach(node => {
      if (node.x !== undefined) node.x += xOffset;
      nodes.push(node);
    });
    
    // Add all derived links
    links.push(...derivedData.links);
    
    // Link root to derived tree
    if (derivedData.root) {
      links.push({
        id: `link-${nodeCounter++}`,
        source: rootNode.id,
        target: derivedData.root.id,
        description: 'Derived from trade'
      });
    }
  });
  
  return {
    nodes,
    links,
    root: rootNode
  };
}

/**
 * Transform TransactionGraph to TreeData for network visualization
 */
export function transformTransactionGraphToD3(graph: TransactionGraph): TreeData {
  const nodes: D3Node[] = [];
  const links: D3Link[] = [];
  
  // Convert asset nodes
  for (const [, asset] of graph.nodes) {
    const node = transformAssetToD3Node(asset);
    nodes.push(node);
  }
  
  // Convert transaction chains to nodes
  for (const [transactionId, transaction] of graph.chains) {
    const transactionNode = transformTransactionToD3Node(transaction);
    nodes.push(transactionNode);
    
    // Create links from transaction to involved assets
    [...transaction.assetsReceived, ...transaction.assetsGiven].forEach(asset => {
      const isReceived = transaction.assetsReceived.some(a => a.id === asset.id);
      
      links.push({
        id: `${transactionId}-${asset.id}`,
        source: isReceived ? transactionNode.id : asset.id,
        target: isReceived ? asset.id : transactionNode.id,
        transactionId: transaction.id,
        transactionType: transaction.type as TransactionType,
        timestamp: transaction.timestamp,
        description: transaction.description,
        strokeColor: isReceived ? '#10B981' : '#F59E0B' // Green for received, orange for given
      });
    });
  }
  
  return {
    nodes,
    links
  };
}

/**
 * Flatten a tree structure for force-directed layout
 */
export function flattenTreeForForceLayout(treeData: TreeData): TreeData {
  const nodes = [...treeData.nodes];
  const links = [...treeData.links];
  
  // Remove fixed positions to let force simulation handle placement
  nodes.forEach(node => {
    delete node.x;
    delete node.y;
    delete node.fx;
    delete node.fy;
  });
  
  return {
    nodes,
    links,
    root: treeData.root
  };
}

/**
 * Filter tree data based on criteria
 */
export function filterTreeData(
  treeData: TreeData, 
  filters: {
    seasons?: string[];
    transactionTypes?: TransactionType[];
    nodeTypes?: NodeType[];
    searchTerm?: string;
  }
): TreeData {
  let filteredNodes = [...treeData.nodes];
  let filteredLinks = [...treeData.links];
  
  // Filter by seasons
  if (filters.seasons && filters.seasons.length > 0) {
    filteredNodes = filteredNodes.filter(node => {
      if (node.type === NodeType.DRAFT_PICK && node.season) {
        return filters.seasons!.includes(node.season);
      }
      if (node.type === NodeType.TRANSACTION && node.timestamp) {
        const year = new Date(node.timestamp).getFullYear().toString();
        return filters.seasons!.includes(year);
      }
      return true; // Keep players and other nodes
    });
  }
  
  // Filter by transaction types
  if (filters.transactionTypes && filters.transactionTypes.length > 0) {
    filteredNodes = filteredNodes.filter(node => {
      if (node.type === NodeType.TRANSACTION && node.transactionType) {
        return filters.transactionTypes!.includes(node.transactionType);
      }
      return true; // Keep non-transaction nodes
    });
  }
  
  // Filter by node types
  if (filters.nodeTypes && filters.nodeTypes.length > 0) {
    filteredNodes = filteredNodes.filter(node => 
      filters.nodeTypes!.includes(node.type)
    );
  }
  
  // Filter by search term
  if (filters.searchTerm) {
    const searchLower = filters.searchTerm.toLowerCase();
    filteredNodes = filteredNodes.filter(node => 
      node.name.toLowerCase().includes(searchLower)
    );
  }
  
  // Filter links to only include those between remaining nodes
  const nodeIds = new Set(filteredNodes.map(n => n.id));
  filteredLinks = filteredLinks.filter(link => {
    const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
    const targetId = typeof link.target === 'string' ? link.target : link.target.id;
    return nodeIds.has(sourceId) && nodeIds.has(targetId);
  });
  
  return {
    nodes: filteredNodes,
    links: filteredLinks,
    root: treeData.root && nodeIds.has(treeData.root.id) ? treeData.root : undefined
  };
}

/**
 * Calculate optimal canvas size based on tree data
 */
export function calculateOptimalSize(treeData: TreeData): { width: number; height: number } {
  const nodeCount = treeData.nodes.length;
  const linkCount = treeData.links.length;
  
  // Base size calculation
  let width = Math.max(800, Math.min(1600, nodeCount * 50));
  let height = Math.max(600, Math.min(1200, nodeCount * 40));
  
  // Adjust for link density
  const avgLinksPerNode = linkCount / nodeCount;
  if (avgLinksPerNode > 2) {
    width *= 1.2;
    height *= 1.2;
  }
  
  return { width: Math.round(width), height: Math.round(height) };
}