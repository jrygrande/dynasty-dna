'use client';

import React from 'react';
import type { TimelineEvent } from '@/lib/api/assets';

interface TransactionWithPosition extends TimelineEvent {
  position: number;
}

interface TransactionDotProps {
  cx: number;
  cy: number;
  onEventClick: (transaction: TransactionWithPosition, position: { cx: number; cy: number }) => void;
  transaction: TransactionWithPosition;
}

const getTransactionColor = (eventType: string): string => {
  switch (eventType) {
    case 'draft_selected':
      return '#3b82f6'; // Blue
    case 'trade':
    case 'pick_trade':
      return '#10b981'; // Green
    case 'waiver_add':
    case 'waiver_drop':
      return '#f59e0b'; // Amber
    case 'free_agent_add':
    case 'free_agent_drop':
      return '#f97316'; // Orange
    case 'add':
    case 'drop':
      return '#ef4444'; // Red
    case 'pick_selected':
      return '#8b5cf6'; // Purple
    case 'season_continuation':
      return '#6366f1'; // Indigo
    default:
      return '#6b7280'; // Gray
  }
};

const getTransactionIcon = (eventType: string): string => {
  switch (eventType) {
    case 'draft_selected':
      return '📋';
    case 'trade':
    case 'pick_trade':
      return '🔄';
    case 'waiver_add':
    case 'waiver_drop':
      return '⚡';
    case 'free_agent_add':
    case 'free_agent_drop':
      return '➕';
    case 'add':
    case 'drop':
      return '↕️';
    case 'pick_selected':
      return '🎯';
    case 'season_continuation':
      return '📅';
    default:
      return '📌';
  }
};

export default function TransactionDot({ cx, cy, onEventClick, transaction }: TransactionDotProps) {
  const dotColor = getTransactionColor(transaction.eventType);
  const icon = getTransactionIcon(transaction.eventType);

  return (
    <svg
      x={cx - 10}
      y={cy - 10}
      width={20}
      height={20}
      onClick={() => onEventClick(transaction, { cx, cy })}
      className="cursor-pointer"
      style={{ overflow: 'visible' }}
    >
      <circle
        cx="10"
        cy="10"
        r="8"
        fill={dotColor}
        stroke="white"
        strokeWidth="2"
        className="transition-all duration-200 hover:stroke-blue-500 hover:stroke-[3px] drop-shadow-md"
      />
      <text
        x="10"
        y="10"
        dy=".35em"
        textAnchor="middle"
        className="font-bold fill-white text-xs pointer-events-none"
        fontSize="8"
      >
        {icon}
      </text>
    </svg>
  );
}