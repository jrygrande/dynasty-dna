'use client';

import React from 'react';
import type { TimelineEvent } from '@/lib/api/assets';

interface TransactionWithPosition extends TimelineEvent {
  position: number;
}

interface TransactionTimelineProps {
  transactions: TransactionWithPosition[];
  chartWidth: number;
  chartMargin: { left: number; right: number };
  maxPosition: number;
  minPosition: number;
  onTransactionClick?: (transaction: TimelineEvent) => void;
}

interface TransactionNodeProps {
  transaction: TransactionWithPosition;
  xPosition: number;
  onTransactionClick?: (transaction: TimelineEvent) => void;
}

const getEventColor = (eventType: string): string => {
  switch (eventType) {
    case 'draft_selected':
      return 'bg-blue-500 hover:bg-blue-600 border-blue-300';
    case 'trade':
    case 'pick_trade':
      return 'bg-green-500 hover:bg-green-600 border-green-300';
    case 'waiver_add':
    case 'waiver_drop':
      return 'bg-yellow-500 hover:bg-yellow-600 border-yellow-300';
    case 'free_agent_add':
    case 'free_agent_drop':
      return 'bg-orange-500 hover:bg-orange-600 border-orange-300';
    case 'add':
    case 'drop':
      return 'bg-red-500 hover:bg-red-600 border-red-300';
    case 'pick_selected':
      return 'bg-purple-500 hover:bg-purple-600 border-purple-300';
    case 'season_continuation':
      return 'bg-indigo-500 hover:bg-indigo-600 border-indigo-300';
    default:
      return 'bg-gray-500 hover:bg-gray-600 border-gray-300';
  }
};

const getEventIcon = (eventType: string): string => {
  switch (eventType) {
    case 'draft_selected':
      return '📋';
    case 'trade':
    case 'pick_trade':
      return '🔄';
    case 'waiver_add':
      return '➕';
    case 'waiver_drop':
      return '➖';
    case 'free_agent_add':
      return '🆓';
    case 'free_agent_drop':
      return '💨';
    case 'add':
      return '⬆️';
    case 'drop':
      return '⬇️';
    case 'pick_selected':
      return '🎯';
    case 'season_continuation':
      return '📅';
    default:
      return '📌';
  }
};

const formatEventType = (eventType: string): string => {
  return eventType
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const TransactionNode: React.FC<TransactionNodeProps> = ({
  transaction,
  xPosition,
  onTransactionClick
}) => {
  const handleClick = () => {
    if (onTransactionClick) {
      const { position, ...timelineEvent } = transaction;
      onTransactionClick(timelineEvent);
    }
  };

  const colorClasses = getEventColor(transaction.eventType);
  const icon = getEventIcon(transaction.eventType);
  const label = formatEventType(transaction.eventType);

  return (
    <div
      className="absolute flex flex-col items-center cursor-pointer group"
      style={{ left: `${xPosition}px`, transform: 'translateX(-50%)' }}
      onClick={handleClick}
    >
      {/* Connection line to chart above */}
      <div className="w-px h-6 bg-gray-300 opacity-50 group-hover:opacity-75 transition-opacity" />

      {/* Transaction node */}
      <div
        className={`
          w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm
          shadow-md transition-all duration-200 group-hover:scale-110 group-hover:shadow-lg
          ${colorClasses}
        `}
        title={`${label} - ${transaction.eventTime ? new Date(transaction.eventTime).toLocaleDateString() : 'Unknown date'}`}
      >
        <span className="text-xs">{icon}</span>
      </div>

      {/* Event type label */}
      <div className="text-xs text-gray-600 mt-1 max-w-16 text-center leading-tight">
        {label}
      </div>
    </div>
  );
};

export default function TransactionTimeline({
  transactions,
  chartWidth,
  chartMargin,
  maxPosition,
  minPosition,
  onTransactionClick
}: TransactionTimelineProps) {
  if (transactions.length === 0) {
    return null;
  }

  // Calculate x positions for each transaction based on their position value
  const calculateXPosition = (position: number): number => {
    const chartAreaWidth = chartWidth - chartMargin.left - chartMargin.right;
    const positionRange = maxPosition - minPosition;
    const relativePosition = (position - minPosition) / positionRange;
    // Add offset to better align with Recharts bar positioning
    return chartMargin.left + (relativePosition * chartAreaWidth) + 32;
  };

  return (
    <div className="relative w-full" style={{ height: '80px', marginTop: '10px' }}>
      {/* Timeline background */}
      <div className="absolute top-6 left-0 right-0 h-px bg-gray-200" />

      {/* Transaction nodes */}
      {transactions.map((transaction, index) => (
        <TransactionNode
          key={`${transaction.id}-${index}`}
          transaction={transaction}
          xPosition={calculateXPosition(transaction.position)}
          onTransactionClick={onTransactionClick}
        />
      ))}
    </div>
  );
}