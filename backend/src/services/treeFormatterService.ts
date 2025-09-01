import { AssetTradeTree, AssetNode } from './assetTradeTreeService';

export class TreeFormatterService {
  
  /**
   * Format a complete asset trade tree as ASCII tree visualization
   */
  formatAssetTree(tree: AssetTradeTree, showDetails: boolean = true): string {
    const lines: string[] = [];
    
    // Root asset line with origin info
    const rootLine = this.formatRootAsset(tree.asset, tree.origin, showDetails);
    lines.push(rootLine);
    
    // Add chronological history if requested and available
    if (showDetails && tree.chronologicalHistory.length > 0) {
      lines.push(`│   Timeline: ${tree.chronologicalHistory.length} transactions over ${tree.timeline.totalDaysTracked} days`);
    }
    
    // Format trade branches recursively
    if (tree.finalTrade?.tradePackage.assetsReceived.length) {
      lines.push('├── Traded for:');
      this.formatTradeBranches(tree.finalTrade.tradePackage.assetsReceived, lines, '│   ');
    } else if (tree.currentStatus.type === 'on_roster' && tree.currentStatus.currentManager) {
      lines.push(`└── Currently on ${tree.currentStatus.currentManager.displayName || tree.currentStatus.currentManager.username}'s roster`);
    } else if (tree.currentStatus.type === 'drafted_as_player' && tree.currentStatus.transformedTo) {
      lines.push(`└── Used to draft ${tree.currentStatus.transformedTo.name}`);
    } else if (tree.currentStatus.type === 'dropped') {
      lines.push('└── Dropped from league');
    }
    
    return lines.join('\n');
  }
  
  /**
   * Format the root asset line with origin information
   */
  private formatRootAsset(asset: AssetNode, origin: AssetTradeTree['origin'], showDetails: boolean): string {
    let line = asset.name;
    
    if (showDetails && origin.type !== 'unknown') {
      const originDesc = this.formatOriginDescription(origin);
      line += ` (${originDesc})`;
    }
    
    return line;
  }
  
  /**
   * Format origin description
   */
  private formatOriginDescription(origin: AssetTradeTree['origin']): string {
    const manager = origin.originalManager.displayName || origin.originalManager.username;
    const year = origin.date.getFullYear();
    
    switch (origin.type) {
      case 'startup_draft':
        return `Startup Draft ${year} by ${manager}`;
      case 'rookie_draft':
        return `Drafted ${year} by ${manager}`;
      case 'waiver':
        return `Waiver pickup ${year} by ${manager}`;
      case 'free_agent':
        return `Free agent pickup ${year} by ${manager}`;
      default:
        return `Acquired ${year} by ${manager}`;
    }
  }
  
  /**
   * Recursively format trade branches
   */
  private formatTradeBranches(
    receivedAssets: AssetTradeTree[], 
    lines: string[], 
    prefix: string
  ): void {
    receivedAssets.forEach((receivedTree, index) => {
      const isLast = index === receivedAssets.length - 1;
      const currentPrefix = prefix + (isLast ? '└── ' : '├── ');
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');
      
      // Format the asset line
      const assetLine = currentPrefix + this.formatAssetWithContext(receivedTree);
      lines.push(assetLine);
      
      // Add current status or recursive branches
      if (receivedTree.finalTrade?.tradePackage.assetsReceived.length) {
        // Has further trades - recurse
        const tradePrefix = nextPrefix + '└── Traded for:';
        lines.push(tradePrefix);
        this.formatTradeBranches(
          receivedTree.finalTrade.tradePackage.assetsReceived, 
          lines, 
          nextPrefix + '    '
        );
      } else {
        // Terminal state - show current status
        const statusLine = this.formatTerminalStatus(receivedTree, nextPrefix);
        if (statusLine) {
          lines.push(statusLine);
        }
      }
    });
  }
  
  /**
   * Format asset with relevant context (current owner, transformation, etc.)
   */
  private formatAssetWithContext(tree: AssetTradeTree): string {
    let line = tree.asset.name;
    
    // Add current owner context if different from origin
    if (tree.currentStatus.currentManager && 
        tree.currentStatus.currentManager.id !== tree.origin.originalManager.id) {
      const owner = tree.currentStatus.currentManager.displayName || tree.currentStatus.currentManager.username;
      if (tree.asset.type === 'draft_pick') {
        line = `${owner}'s ${tree.asset.name}`;
      }
    }
    
    // Show draft pick transformation
    if (tree.currentStatus.type === 'drafted_as_player' && tree.currentStatus.transformedTo) {
      line += ` → Selected ${tree.currentStatus.transformedTo.name}`;
    }
    
    return line;
  }
  
  /**
   * Format terminal status for assets that weren't traded further
   */
  private formatTerminalStatus(tree: AssetTradeTree, prefix: string): string | null {
    const { currentStatus } = tree;
    
    switch (currentStatus.type) {
      case 'on_roster':
        if (currentStatus.currentManager) {
          const owner = currentStatus.currentManager.displayName || currentStatus.currentManager.username;
          return `${prefix}└── Currently on ${owner}'s roster`;
        }
        return null;
        
      case 'dropped':
        return `${prefix}└── Dropped from league`;
        
      case 'drafted_as_player':
        if (currentStatus.transformedTo) {
          return `${prefix}└── Became ${currentStatus.transformedTo.name}`;
        }
        return null;
        
      default:
        return null;
    }
  }
  
  /**
   * Format a simple list of assets (for debugging/summary)
   */
  formatAssetList(assets: AssetNode[]): string {
    return assets.map(asset => {
      if (asset.type === 'draft_pick') {
        return `${asset.season} Round ${asset.round} Pick`;
      }
      return `${asset.name} (${asset.position || 'N/A'})`;
    }).join(', ');
  }
  
  /**
   * Create a compact tree summary
   */
  formatTreeSummary(tree: AssetTradeTree): string {
    const lines: string[] = [];
    
    lines.push(`${tree.asset.name}:`);
    lines.push(`  • Origin: ${this.formatOriginDescription(tree.origin)}`);
    lines.push(`  • Transactions: ${tree.chronologicalHistory.length}`);
    lines.push(`  • Days tracked: ${tree.timeline.totalDaysTracked}`);
    
    if (tree.finalTrade) {
      lines.push(`  • Final trade: ${tree.finalTrade.tradePackage.totalValue}`);
      lines.push(`  • Branching assets: ${tree.finalTrade.tradePackage.assetsReceived.length}`);
    }
    
    lines.push(`  • Status: ${tree.currentStatus.type}`);
    
    return lines.join('\n');
  }
}

// Export singleton instance
export const treeFormatterService = new TreeFormatterService();