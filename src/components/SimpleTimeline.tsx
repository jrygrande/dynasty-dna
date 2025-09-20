import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import TimelineEventNode from './TimelineEventNode';
import type { TimelineEvent } from '@/lib/api/assets';

interface SimpleTimelineProps {
  events: TimelineEvent[];
  onEventClick: (event: TimelineEvent) => void;
}

export default function SimpleTimeline({ events, onEventClick }: SimpleTimelineProps) {
  if (!events.length) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        No timeline events found
      </div>
    );
  }

  // Sort events chronologically
  const sortedEvents = [...events].sort((a, b) => {
    const dateA = new Date(a.eventTime || '');
    const dateB = new Date(b.eventTime || '');
    return dateA.getTime() - dateB.getTime();
  });

  return (
    <div className="w-full py-8">
      <ScrollArea className="w-full">
        <div className="relative px-8">
          {/* Timeline line */}
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-gray-300 transform -translate-y-1/2" />

          {/* Event nodes */}
          <div className="flex items-center gap-16 min-w-max">
            {sortedEvents.map((event, index) => (
              <div key={event.id} className="relative">
                <TimelineEventNode
                  event={event}
                  onClick={onEventClick}
                />

                {/* Connection line to next event */}
                {index < sortedEvents.length - 1 && (
                  <div className="absolute top-1/2 right-0 w-16 h-0.5 bg-gray-300 transform -translate-y-1/2 translate-x-full" />
                )}
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}