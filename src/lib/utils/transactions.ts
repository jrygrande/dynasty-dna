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

  // Create a mapping from roster IDs to users
  const rosterToUser = new Map<number, any>();
  if (fromUser && fromRosterId) {
    rosterToUser.set(fromRosterId, fromUser);
  }
  if (toUser && toRosterId) {
    rosterToUser.set(toRosterId, toUser);
  }

  for (const asset of assets) {
    // For each asset, determine who received it based on toRosterId
    let recipientUser = null;
    let recipientUserId = null;

    if (asset.toRosterId && rosterToUser.has(asset.toRosterId)) {
      recipientUser = rosterToUser.get(asset.toRosterId);
      recipientUserId = recipientUser.id;
    } else if (asset.fromRosterId && rosterToUser.has(asset.fromRosterId)) {
      // If toRosterId is null, this might be a "from" movement, so the other party gets it
      const otherRosterIds = Array.from(rosterToUser.keys()).filter(id => id !== asset.fromRosterId);
      if (otherRosterIds.length > 0) {
        recipientUser = rosterToUser.get(otherRosterIds[0]);
        recipientUserId = recipientUser?.id;
      }
    }

    // For picks that don't have roster IDs, assign them to fromUser (andrewduke23)
    // This is based on the understanding that picks typically go to the "giver" in compensation
    if (!recipientUserId && asset.assetKind === 'pick') {
      recipientUser = fromUser;
      recipientUserId = fromUser?.id;
    }

    if (!recipientUserId) {
      continue;
    }

    if (!userMap.has(recipientUserId)) {
      userMap.set(recipientUserId, {
        userId: recipientUserId,
        user: recipientUser,
        assets: []
      });
    }

    userMap.get(recipientUserId)!.assets.push(asset);
  }

  return Array.from(userMap.values());
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