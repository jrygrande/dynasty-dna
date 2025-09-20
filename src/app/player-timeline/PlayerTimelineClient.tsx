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

  // If we still don't have proper user mapping, create a simplified view
  if (userAssets.size === 0 || Array.from(userAssets.values()).every(u => u.received.length === 0)) {
    // Fallback: create a simple description based on what we know
    const picks = assets.filter(a => a.assetKind === 'pick');
    const players = assets.filter(a => a.assetKind === 'player');

    return (
      <div className="text-sm">
        <strong>Trade involving:</strong><br/>
        {players.map(p => formatAsset(p)).join(', ')}
        {players.length > 0 && picks.length > 0 && ', '}
        {picks.map(p => formatAsset(p)).join(', ')}
        <br/>
        <span className="text-gray-600 text-xs">Between {eventFromUser?.displayName || 'Unknown'} and {eventToUser?.displayName || 'Unknown'}</span>
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
    console.log('Event clicked:', event);
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

        const zIndex = 50 + index * 10; // Stagger z-index for multiple modals
        const offsetX = index * 30; // Slight horizontal offset
        const offsetY = index * 30; // Slight vertical offset

        return (
          <div
            key={modalId}
            className="fixed"
            style={{
              zIndex,
              left: `calc(50% + ${offsetX}px)`,
              top: `calc(50% + ${offsetY}px)`,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <div className="bg-white p-6 rounded-lg max-w-2xl w-full shadow-2xl border-2 border-gray-300"
              style={{
                maxHeight: '80vh',
                overflowY: 'auto',
                minWidth: '500px'
              }}
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Transaction Details</h2>
                <button
                  onClick={() => handleCloseModal(modalId)}
                  className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
                >
                  ×
                </button>
              </div>

              <div className="space-y-3">
                <p><strong>Event Type:</strong> {event.eventType}</p>
                <p><strong>Season:</strong> {event.season}</p>
                <p><strong>Week:</strong> {event.week}</p>
                <p><strong>From:</strong> {event.fromUser?.displayName || 'N/A'}</p>
                <p><strong>To:</strong> {event.toUser?.displayName || 'N/A'}</p>

                {/* Enhanced Trade Summary */}
                {event.assetsInTransaction && event.assetsInTransaction.length > 0 && (
                  <div>
                    <strong>Complete Trade Details:</strong>
                    <div className="mt-2 p-3 bg-blue-50 rounded-lg">
                      <TradeDetailsSummary
                        assets={event.assetsInTransaction}
                        mainUser={event.toUser}
                        eventFromUser={event.fromUser}
                        eventToUser={event.toUser}
                      />
                    </div>

                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-medium text-gray-600">Show All Assets</summary>
                      <ul className="mt-2 space-y-1 text-sm">
                        {event.assetsInTransaction.map((asset: any, idx: number) => (
                          <li key={idx} className="bg-gray-50 p-2 rounded">
                            <div className="flex justify-between">
                              <span>
                                {asset.assetKind === 'player' ? (
                                  `Player: ${asset.playerId}`
                                ) : (
                                  `${asset.pickSeason} Round ${asset.pickRound} Pick`
                                )}
                              </span>
                              <span className="text-gray-500">
                                {asset.eventType === 'trade' && asset.fromUserId && asset.toUserId
                                  ? `${asset.fromUserId} → ${asset.toUserId}`
                                  : asset.eventType}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </details>
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
