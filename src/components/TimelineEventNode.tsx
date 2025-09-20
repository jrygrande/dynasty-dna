import React from 'react';
import { Badge } from '@/components/ui/badge';
import type { TimelineEvent } from '@/lib/api/assets';

interface TimelineEventNodeProps {
  event: TimelineEvent;
  onClick: (event: TimelineEvent) => void;
}

const getEventColor = (eventType: string): string => {
  switch (eventType) {
    case 'draft_selected':
      return 'bg-blue-500 hover:bg-blue-600';
    case 'trade':
    case 'pick_trade':
      return 'bg-green-500 hover:bg-green-600';
    case 'waiver_add':
    case 'waiver_drop':
      return 'bg-yellow-500 hover:bg-yellow-600';
    case 'free_agent_add':
    case 'free_agent_drop':
      return 'bg-orange-500 hover:bg-orange-600';
    case 'add':
    case 'drop':
      return 'bg-red-500 hover:bg-red-600';
    case 'pick_selected':
      return 'bg-purple-500 hover:bg-purple-600';
    default:
      return 'bg-gray-500 hover:bg-gray-600';
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

const formatDate = (dateString: string | null): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

export default function TimelineEventNode({ event, onClick }: TimelineEventNodeProps) {
  const eventColor = getEventColor(event.eventType);
  const eventIcon = getEventIcon(event.eventType);
  const eventLabel = formatEventType(event.eventType);
  const eventDate = formatDate(event.eventTime);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('TimelineEventNode clicked:', event.eventType);
    onClick(event);
  };

  return (
    <div className="flex flex-col items-center group cursor-pointer" onClick={handleClick}>
      {/* Date above node */}
      <div className="text-xs text-gray-500 mb-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {eventDate}
      </div>

      {/* Event node */}
      <div className={`
        w-12 h-12 rounded-full flex items-center justify-center text-white text-lg
        ${eventColor} transition-colors duration-200
        border-4 border-white shadow-lg
      `}>
        {eventIcon}
      </div>

      {/* Event type label below node */}
      <div className="text-xs text-gray-700 mt-2 text-center max-w-20">
        {eventLabel}
      </div>

      {/* Season/Week badge */}
      <Badge variant="outline" className="text-xs mt-1">
        {event.season} W{event.week || 0}
      </Badge>
    </div>
  );
}