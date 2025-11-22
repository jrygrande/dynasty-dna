import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import type { TimelineEvent, TimelineAsset } from '@/lib/api/assets';
import { formatAssetName, getUserDisplayName } from '@/lib/utils/transactions';

interface DraftSelectionModalProps {
  event: TimelineEvent;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  playerId?: string; // Current player context for the timeline
  onAssetClick?: (asset: TimelineAsset) => void;
}

const formatDate = (dateString: string | null): string => {
  if (!dateString) return 'Unknown date';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const getPlayerName = async (event: TimelineEvent, currentPlayerId?: string): Promise<string> => {
  let playerId: string | undefined;

  // Check if we have player ID information in details
  if (event.details && typeof event.details === 'object') {
    const details = event.details as any;
    if (details.playerId) {
      playerId = details.playerId;
    }
  }

  // Use the current player context from the timeline
  if (!playerId && currentPlayerId) {
    playerId = currentPlayerId;
  }

  // If we have a player ID, fetch the actual player data via API
  if (playerId) {
    try {
      console.log('Fetching player via API:', playerId);
      const response = await fetch(`/api/players/${playerId}`);
      if (response.ok) {
        const player = await response.json();
        console.log('Player data from API:', player);
        if (player && player.name) {
          return player.name;
        }
      } else {
        console.error('API request failed:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Failed to fetch player via API:', error);
    }

    // Fallback to formatted asset name if API fetch fails
    console.log('Falling back to formatAssetName for player:', playerId);
    return formatAssetName({ assetKind: 'player', playerId });
  }

  // Fallback to unknown player
  return 'Unknown Player';
};

export default function DraftSelectionModal({ event, isOpen, onOpenChange, playerId, onAssetClick }: DraftSelectionModalProps) {
  const [playerName, setPlayerName] = useState<string>('Loading...');
  const managerName = getUserDisplayName(event.toUser);

  useEffect(() => {
    getPlayerName(event, playerId).then(setPlayerName);
  }, [event, playerId]);

  // Extract draft details
  const details = (event.details || {}) as any;
  const round = details.round || 'Unknown';
  const pickNo = details.pickNo || 'Unknown';

  // Check if we have pick provenance
  const pickAsset = details.pickAsset;
  const hasPickProvenance = pickAsset && pickAsset.season && pickAsset.round && pickAsset.originalRosterId;

  const handlePickClick = () => {
    if (hasPickProvenance && onAssetClick) {
      const pickTimelineAsset: TimelineAsset = {
        id: `pick-${pickAsset.season}-${pickAsset.round}-${pickAsset.originalRosterId}`,
        assetKind: 'pick',
        eventType: 'pick_trade',
        pickSeason: pickAsset.season,
        pickRound: pickAsset.round,
        pickOriginalRosterId: pickAsset.originalRosterId,
      };
      onAssetClick(pickTimelineAsset);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-center">Draft Selection Details</DialogTitle>
          <DialogDescription className="text-center">
            A player was selected in the rookie draft.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-4">
          {/* Selected By */}
          <div className="flex justify-between items-center text-lg">
            <span className="font-semibold text-gray-600">Selected By:</span>
            <span className="font-bold text-gray-900">{managerName}</span>
          </div>

          <Separator />

          {/* Player Selected */}
          <div className="flex justify-between items-center text-lg">
            <span className="font-semibold text-gray-600">Player Selected:</span>
            <span className="font-bold text-emerald-600">{playerName}</span>
          </div>

          <Separator />

          {/* Pick Details */}
          <div className="flex justify-between items-center text-lg">
            <span className="font-semibold text-gray-600">Pick Details:</span>
            <span className="font-bold text-gray-900">
              Round {round} | Pick #{pickNo}
            </span>
          </div>

          {/* Pick Provenance - Show if available */}
          {hasPickProvenance && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="text-sm font-semibold text-gray-600">Pick History:</div>
                <div className="text-sm text-gray-700">
                  {pickAsset.hadTrades ? (
                    <span className="text-blue-600">
                      This pick was traded {pickAsset.tradeCount} time{pickAsset.tradeCount !== 1 ? 's' : ''} before selection
                    </span>
                  ) : (
                    <span className="text-gray-500">
                      This pick was not traded before selection
                    </span>
                  )}
                </div>
                {onAssetClick && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePickClick}
                    className="w-full mt-2"
                  >
                    View Pick Timeline
                  </Button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="text-center text-sm text-gray-500 mt-4">
          Draft Date: {formatDate(event.eventTime)}
        </div>
      </DialogContent>
    </Dialog>
  );
}