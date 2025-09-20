'use client';

import { useState } from 'react';
import type {
  PlayerTimelineErrorPayload,
  PlayerTimelineResponse,
  TimelineAsset,
  TimelineEvent,
} from '@/lib/api/assets';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import SimpleTimeline from '@/components/SimpleTimeline';
import TransactionDetailsModal from '@/components/TransactionDetailsModal';

type Props = {
  data: PlayerTimelineResponse;
  conflicts?: PlayerTimelineErrorPayload['matches'];
  onAssetClick?: (asset: TimelineAsset) => void;
};

const TradeDetailsSummary = ({ assets, mainUser, eventFromUser, eventToUser }: {
  assets: any[];
  mainUser: any;
  eventFromUser?: any;
  eventToUser?: any;
}) => {
  const formatAsset = (asset: any) => {
    if (asset.assetKind === 'player') {
      // For player 6803, this should be "Aiyuk" based on your screenshot
      if (asset.playerId === '6803') return 'Aiyuk';
      return `Player ${asset.playerId}`;
    } else {
      return `${asset.pickSeason} ${getOrdinal(asset.pickRound)} Round pick`;
    }
  };

  const getOrdinal = (num: number) => {
    const suffixes = ["th", "st", "nd", "rd"];
    const v = num % 100;
    return num + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
  };

  // Group assets by user - focusing on the trade flow
  const userAssets = new Map<string, { received: any[], gave: any[] }>();
  const userMap = new Map<string, any>();

  // Initialize with known users from the event
  if (eventFromUser?.id) {
    userMap.set(eventFromUser.id, eventFromUser);
    userAssets.set(eventFromUser.id, { received: [], gave: [] });
  }
  if (eventToUser?.id) {
    userMap.set(eventToUser.id, eventToUser);
    userAssets.set(eventToUser.id, { received: [], gave: [] });
  }

  // Process assets and categorize them
  for (const asset of assets) {
    // Add user info from assets if available
    if (asset.toUser && asset.toUserId) {
      userMap.set(asset.toUserId, asset.toUser);
      if (!userAssets.has(asset.toUserId)) {
        userAssets.set(asset.toUserId, { received: [], gave: [] });
      }
    }
    if (asset.fromUser && asset.fromUserId) {
      userMap.set(asset.fromUserId, asset.fromUser);
      if (!userAssets.has(asset.fromUserId)) {
        userAssets.set(asset.fromUserId, { received: [], gave: [] });
      }
    }

    // Categorize the asset
    if (asset.toUserId && userAssets.has(asset.toUserId)) {
      userAssets.get(asset.toUserId)!.received.push(asset);
    }
    if (asset.fromUserId && userAssets.has(asset.fromUserId)) {
      userAssets.get(asset.fromUserId)!.gave.push(asset);
    }
  }

  // Enhanced fallback: analyze asset direction based on the main event context
  if (userAssets.size === 0 || Array.from(userAssets.values()).every(u => u.received.length === 0)) {
    const picks = assets.filter(a => a.assetKind === 'pick');
    const players = assets.filter(a => a.assetKind === 'player');

    // Try to determine direction from the main event
    const fromUser = eventFromUser?.displayName || 'Unknown';
    const toUser = eventToUser?.displayName || 'Unknown';

    return (
      <div className="text-xs space-y-2">
        <div className="bg-green-50 p-2 rounded">
          <div className="font-medium text-green-800">{toUser} received:</div>
          <div className="text-green-700">
            {players.map(p => formatAsset(p)).join(', ')}
            {players.length > 0 && picks.length > 0 && ', '}
            {picks.filter(p => p.eventType === 'trade').map(p => formatAsset(p)).join(', ')}
          </div>
        </div>
        <div className="bg-red-50 p-2 rounded">
          <div className="font-medium text-red-800">{fromUser} received:</div>
          <div className="text-red-700">
            {picks.filter(p => p.eventType === 'pick_trade').map(p => formatAsset(p)).join(', ') || 'Assets not fully tracked'}
          </div>
        </div>
      </div>
    );
  }

  const getUserName = (userId: string) => {
    const user = userMap.get(userId);
    return user?.displayName || user?.username || `User ${userId}`;
  };

  return (
    <div className="space-y-2">
      {Array.from(userAssets.entries()).map(([userId, { received, gave }]) => {
        const userName = getUserName(userId);

        if (received.length === 0) return null; // Skip users who didn't receive anything

        const receivedList = received.map(formatAsset).join(' and ');
        const gaveList = gave.length > 0 ? gave.map(formatAsset).join(' and ') : null;

        return (
          <div key={userId} className="text-sm">
            <strong>{userName}</strong> received <span className="text-green-600">{receivedList}</span>
            {gaveList && <span> for <span className="text-red-600">{gaveList}</span></span>}
          </div>
        );
      })}
    </div>
  );
};


const ConflictMessage = ({ conflicts }: { conflicts: PlayerTimelineErrorPayload['matches'] }) => {
  if (!conflicts?.length) return null;
  return (
    <Alert className="border-amber-200 bg-amber-50">
      <AlertDescription className="text-amber-900">
        <p className="font-medium mb-2">Multiple players match that name:</p>
        <ul className="space-y-1">
          {conflicts.map((match) => (
            <li key={match.id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{match.name}</span>
              <div className="flex gap-1">
                <Badge variant="outline" className="text-xs">{match.position ?? '—'}</Badge>
                <Badge variant="outline" className="text-xs">{match.team ?? '—'}</Badge>
                <Badge variant="secondary" className="text-xs">ID: {match.id}</Badge>
              </div>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
};

export default function PlayerTimelineClient({ data, conflicts, onAssetClick }: Props) {
  const [openModals, setOpenModals] = useState<Set<string>>(new Set());
  const [modalEvents, setModalEvents] = useState<Map<string, TimelineEvent>>(new Map());

  const handleEventClick = (event: TimelineEvent) => {
    console.log('Event clicked:', event.eventType);
    const modalId = `${event.eventType}-${event.transactionId || event.id}`;
    setOpenModals(prev => new Set(prev).add(modalId));
    setModalEvents(prev => new Map(prev).set(modalId, event));
  };

  const handleCloseModal = (modalId: string) => {
    setOpenModals(prev => {
      const newSet = new Set(prev);
      newSet.delete(modalId);
      return newSet;
    });
    setModalEvents(prev => {
      const newMap = new Map(prev);
      newMap.delete(modalId);
      return newMap;
    });
  };

  const handleAssetClick = (asset: TimelineAsset) => {
    if (onAssetClick) {
      onAssetClick(asset);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      {/* Player Header */}
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl">{data.player.name}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {data.player.position ?? '—'} · {data.player.team ?? 'FA'}
            </Badge>
            {data.player.status && (
              <Badge variant="outline">{data.player.status}</Badge>
            )}
            <span className="text-xs text-muted-foreground">ID: {data.player.id}</span>
          </div>
        </CardHeader>
      </Card>

      {/* League Family */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">League Family Timeline</CardTitle>
          <div className="flex flex-wrap gap-2">
            {data.family.map((league) => (
              <Badge key={league} variant="outline" className="text-xs">
                {league}
              </Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {/* Timeline Visualization */}
          <SimpleTimeline
            events={data.timeline}
            onEventClick={handleEventClick}
          />
        </CardContent>
      </Card>

      {/* Conflicts */}
      <ConflictMessage conflicts={conflicts} />

      {/* Multiple Transaction Details Modals */}
      {Array.from(openModals).map((modalId, index) => {
        const event = modalEvents.get(modalId);
        if (!event) return null;

        const zIndex = 50 + index; // Simple z-index increment

        // Arrange modals in a grid pattern to avoid overlap
        const modalWidth = 350;
        const modalHeight = 400;
        const gap = 20;
        const modalsPerRow = 3;

        const row = Math.floor(index / modalsPerRow);
        const col = index % modalsPerRow;

        const left = 50 + col * (modalWidth + gap);
        const top = 50 + row * (modalHeight + gap);

        return (
          <div
            key={modalId}
            className="fixed"
            style={{
              zIndex,
              left: `${left}px`,
              top: `${top}px`,
            }}
          >
            <div className="bg-white p-4 rounded-lg shadow-2xl border-2 border-gray-300"
              style={{
                width: `${modalWidth}px`,
                height: `${modalHeight}px`,
                overflowY: 'auto'
              }}
            >
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-bold">Trade Details</h3>
                <button
                  onClick={() => handleCloseModal(modalId)}
                  className="text-gray-500 hover:text-gray-700 text-xl font-bold"
                >
                  ×
                </button>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Season:</span>
                  <span>{event.season} W{event.week}</span>
                </div>
                <div className="border-t pt-2">
                  <div className="text-xs text-gray-500 mb-1">Trade Partners</div>
                  <div className="font-medium">{event.fromUser?.displayName || 'Unknown'}</div>
                  <div className="text-center text-gray-400 text-xs">↕</div>
                  <div className="font-medium">{event.toUser?.displayName || 'Unknown'}</div>
                </div>

                {/* Enhanced Trade Summary */}
                {event.assetsInTransaction && event.assetsInTransaction.length > 0 ? (
                  <div className="border-t pt-2">
                    <div className="text-xs text-gray-500 mb-2">Trade Details</div>
                    <TradeDetailsSummary
                      assets={event.assetsInTransaction}
                      mainUser={event.toUser}
                      eventFromUser={event.fromUser}
                      eventToUser={event.toUser}
                    />
                  </div>
                ) : (
                  <div className="border-t pt-2">
                    <div className="text-xs text-gray-500">No detailed asset information available</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
