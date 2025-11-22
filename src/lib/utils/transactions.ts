import type { TimelineAsset } from '@/lib/api/assets';

export interface AssetsByUser {
  userId: string;
  user: {
    id: string;
    username: string | null;
    displayName: string | null;
  } | null;
  assets: TimelineAsset[];
}

export function groupAssetsByRecipient(assets: any[], fromUser?: any, toUser?: any, fromRosterId?: number | null, toRosterId?: number | null): AssetsByUser[] {
  const userMap = new Map<string, AssetsByUser>();

  // Build user map from all unique user IDs in the assets
  // This is more robust than relying on fromUser/toUser parameters
  const userIds = new Set<string>();
  assets.forEach(asset => {
    if (asset.toUserId) userIds.add(asset.toUserId);
    if (asset.fromUserId) userIds.add(asset.fromUserId);
  });

  // Initialize user map with all users found in assets
  userIds.forEach(userId => {
    // Try to find display name from fromUser/toUser if available
    let displayName = 'Unknown User';
    let user = null;

    if (fromUser && fromUser.id === userId) {
      displayName = fromUser.displayName || fromUser.username || 'Unknown User';
      user = fromUser;
    } else if (toUser && toUser.id === userId) {
      displayName = toUser.displayName || toUser.username || 'Unknown User';
      user = toUser;
    }

    if (!user) {
      user = { id: userId, username: null, displayName };
    }

    userMap.set(userId, {
      userId,
      user,
      assets: []
    });
  });

  // Create a mapping from roster IDs to user IDs for quick lookup
  const rosterToUserId = new Map<number, string>();
  if (fromUser && fromRosterId) {
    rosterToUserId.set(fromRosterId, fromUser.id);
  }
  if (toUser && toRosterId) {
    rosterToUserId.set(toRosterId, toUser.id);
  }

  for (const asset of assets) {
    // For each asset, determine who received it
    let recipientUserId: string | null = null;

    // First try roster-based assignment (for players)
    if (asset.toRosterId && rosterToUserId.has(asset.toRosterId)) {
      recipientUserId = rosterToUserId.get(asset.toRosterId)!;
    }
    // If no roster-based assignment, try user ID assignment (for picks)
    else if (asset.toUserId) {
      recipientUserId = asset.toUserId;
    }

    // If we found a recipient, add the asset to their list
    if (recipientUserId && userMap.has(recipientUserId)) {
      userMap.get(recipientUserId)!.assets.push(asset);
    }
  }

  const result = Array.from(userMap.values());
  return result;
}

export function formatAssetName(asset: any): string {
  if (asset.assetKind === 'player') {
    // Use playerName if available, otherwise fall back to playerId
    return asset.playerName || `Player ${asset.playerId || asset.id}`;
  } else if (asset.assetKind === 'pick') {
    const ordinal = getOrdinal(asset.pickRound || 1);
    return `${asset.pickSeason} ${ordinal} Round Pick`;
  }

  return `Unknown Asset ${asset.id}`;
}

export function getUserDisplayName(user: { id: string; username: string | null; displayName: string | null } | null): string {
  if (!user) return 'Unknown User';
  return user.displayName || user.username || `User ${user.id}`;
}

function getOrdinal(num: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = num % 100;
  return num + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}