'use client';

import React from 'react';
import { X } from 'lucide-react';
import type { TimelineEvent } from '@/lib/api/assets';
import TradeDetailsPopup from './TradeDetailsPopup';
import DraftSelectionPopup from './DraftSelectionPopup';

interface TransactionPopupProps {
  event: TimelineEvent;
  xPosition: number;
  onClose: () => void;
  playerId?: string;
}

export default function TransactionPopup({
  event,
  xPosition,
  onClose,
  playerId
}: TransactionPopupProps) {
  // Route to appropriate popup content based on event type
  const isTradeEvent = event.eventType === 'trade' || event.eventType === 'pick_trade';
  const isDraftEvent = event.eventType === 'draft_selected';

  let content = null;

  if (isTradeEvent) {
    content = <TradeDetailsPopup event={event} />;
  } else if (isDraftEvent) {
    content = <DraftSelectionPopup event={event} playerId={playerId} />;
  }

  // Don't render popup for unsupported event types
  if (!content) {
    return null;
  }

  return (
    <div
      className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-4 max-w-sm"
      style={{
        left: `${xPosition}px`,
        transform: 'translateX(-50%)',
        top: '10px', // Position below the timeline
      }}
    >
      {/* Arrow pointing up to the transaction node */}
      <div
        className="absolute -top-2 left-1/2 transform -translate-x-1/2 w-4 h-4 bg-white border-l border-t border-gray-200 rotate-45"
      />

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded-full transition-colors"
        aria-label="Close popup"
      >
        <X size={14} className="text-gray-500" />
      </button>

      {/* Popup content */}
      <div className="pr-6">
        {content}
      </div>
    </div>
  );
}