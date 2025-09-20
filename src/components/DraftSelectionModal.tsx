import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import type { TimelineEvent } from '@/lib/api/assets';
import { formatAssetName, getUserDisplayName } from '@/lib/utils/transactions';

interface DraftSelectionModalProps {
  event: TimelineEvent;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  playerId?: string; // Current player context for the timeline
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

const getPlayerName = (event: TimelineEvent, currentPlayerId?: string): string => {
  // For draft events, the player being drafted is represented by the event details
  // We can derive the player ID from the context of which player timeline we're viewing

  // Check if we have player ID information in details
  if (event.details && typeof event.details === 'object') {
    const details = event.details as any;
    if (details.playerId) {
      return formatAssetName({ assetKind: 'player', playerId: details.playerId });
    }
  }

  // Use the current player context from the timeline
  if (currentPlayerId) {
    return formatAssetName({ assetKind: 'player', playerId: currentPlayerId });
  }

  // Fallback to unknown player
  return 'Unknown Player';
};

export default function DraftSelectionModal({ event, isOpen, onOpenChange, playerId }: DraftSelectionModalProps) {
  const managerName = getUserDisplayName(event.toUser);
  const playerName = getPlayerName(event, playerId);

  // Extract draft details
  const details = (event.details || {}) as any;
  const round = details.round || 'Unknown';
  const pickNo = details.pickNo || 'Unknown';

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
        </div>

        <div className="text-center text-sm text-gray-500 mt-4">
          Draft Date: {formatDate(event.eventTime)}
        </div>
      </DialogContent>
    </Dialog>
  );
}