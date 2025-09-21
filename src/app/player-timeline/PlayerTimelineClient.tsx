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
import PerformanceTimeline from '@/components/PerformanceTimeline';
import TransactionDetailsModal from '@/components/TransactionDetailsModal';
import { groupAssetsByRecipient, formatAssetName, getUserDisplayName } from '@/lib/utils/transactions';

type Props = {
  data: PlayerTimelineResponse;
  conflicts?: PlayerTimelineErrorPayload['matches'];
  onAssetClick?: (asset: TimelineAsset) => void;
};

const TradeDetailsSummary = ({ assets }: { assets: any[] }) => {
  // Group assets by who received them
  const assetsByRecipient = groupAssetsByRecipient(assets);

  if (assetsByRecipient.length === 0) {
    return (
      <div className="text-sm text-gray-500">
        No asset details available
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {assetsByRecipient.map(({ userId, user, assets: userAssets }) => {
        const userName = getUserDisplayName(user);
        const assetNames = userAssets.map(formatAssetName);

        return (
          <div key={userId} className="bg-blue-50 p-3 rounded-lg">
            <div className="font-medium text-blue-800 mb-1">
              {userName} received:
            </div>
            <div className="text-blue-700 text-sm">
              {assetNames.join(', ')}
            </div>
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
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleEventClick = (event: TimelineEvent) => {
    console.log('Event clicked:', event.eventType);
    setSelectedEvent(event);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedEvent(null);
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
          {/* Timeline Visualization with Performance Metrics */}
          <PerformanceTimeline
            events={data.timeline}
            onEventClick={handleEventClick}
          />
        </CardContent>
      </Card>

      {/* Conflicts */}
      <ConflictMessage conflicts={conflicts} />

      {/* Transaction Details Modal */}
      <TransactionDetailsModal
        event={selectedEvent}
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        playerId={data.player.id}
      />
    </div>
  );
}
