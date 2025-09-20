import React from 'react';
import type { TimelineEvent } from '@/lib/api/assets';
import TradeDetailsModal from './TradeDetailsModal';
import DraftSelectionModal from './DraftSelectionModal';

interface TransactionDetailsModalProps {
  event: TimelineEvent | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function TransactionDetailsModal({
  event,
  isOpen,
  onOpenChange
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
      />
    );
  }

  if (isDraftEvent) {
    return (
      <DraftSelectionModal
        event={event}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
      />
    );
  }

  // For other event types, don't show a modal
  return null;
}