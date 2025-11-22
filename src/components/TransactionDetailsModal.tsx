import React from 'react';
import type { TimelineEvent, TimelineAsset } from '@/lib/api/assets';
import TradeDetailsModal from './TradeDetailsModal';
import DraftSelectionModal from './DraftSelectionModal';

interface TransactionDetailsModalProps {
  event: TimelineEvent | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  playerId?: string; // Current player context for the timeline
  onAssetClick?: (asset: TimelineAsset) => void; // NEW: Callback when asset is clicked
}

export default function TransactionDetailsModal({
  event,
  isOpen,
  onOpenChange,
  playerId,
  onAssetClick
}: TransactionDetailsModalProps) {
  if (!event) return null;

  // Route to appropriate modal based on event type
  const isTradeEvent = event.eventType === 'trade' || event.eventType === 'pick_trade';
  const isDraftEvent = event.eventType === 'draft_selected';

  if (isTradeEvent) {
    return (
      <TradeDetailsModal
        event={event}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        onAssetClick={onAssetClick}
      />
    );
  }

  if (isDraftEvent) {
    return (
      <DraftSelectionModal
        event={event}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        playerId={playerId}
        onAssetClick={onAssetClick}
      />
    );
  }

  // For other event types, don't show a modal
  return null;
}