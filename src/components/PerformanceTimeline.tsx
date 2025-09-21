import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import TimelineEventNode from './TimelineEventNode';
import type { TimelineEvent, PerformanceMetrics } from '@/lib/api/assets';

interface PerformanceTimelineProps {
  events: TimelineEvent[];
  onEventClick: (event: TimelineEvent) => void;
}

interface SeasonSegment {
  season: string;
  events: TimelineEvent[];
  startIndex: number;
  endIndex: number;
}

const PerformanceMetricsCard: React.FC<{ metrics: PerformanceMetrics }> = ({ metrics }) => {
  const getPerformanceColor = (percentage: number, ppg: number) => {
    if (percentage >= 80 && ppg >= 12) return {
      bg: 'bg-green-50/90',
      border: 'border-green-200',
      text: 'text-green-700',
      accent: 'bg-green-500'
    };
    if (percentage >= 60 && ppg >= 8) return {
      bg: 'bg-blue-50/90',
      border: 'border-blue-200',
      text: 'text-blue-700',
      accent: 'bg-blue-500'
    };
    if (percentage >= 40 || ppg >= 5) return {
      bg: 'bg-yellow-50/90',
      border: 'border-yellow-200',
      text: 'text-yellow-700',
      accent: 'bg-yellow-500'
    };
    return {
      bg: 'bg-red-50/90',
      border: 'border-red-200',
      text: 'text-red-700',
      accent: 'bg-red-500'
    };
  };

  const colors = getPerformanceColor(metrics.startingPercentage, metrics.ppg);

  return (
    <Card className={`
      text-xs border shadow-sm backdrop-blur-sm transform transition-all duration-200
      hover:scale-105 hover:shadow-md ${colors.bg} ${colors.border} ${colors.text}
    `}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-center gap-2">
          <div className={`w-2 h-2 rounded-full ${colors.accent}`}></div>
          <div className="font-semibold">{metrics.season}</div>
        </div>

        {/* Starting percentage bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span>Started</span>
            <span className="font-semibold">{metrics.startingPercentage}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${colors.accent}`}
              style={{ width: `${Math.min(metrics.startingPercentage, 100)}%` }}
            ></div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="text-center">
            <div className="font-semibold text-sm">{metrics.ppg}</div>
            <div className="opacity-75">PPG</div>
          </div>
          <div className="text-center">
            <div className="font-semibold text-sm">{metrics.startingPpg}</div>
            <div className="opacity-75">Start PPG</div>
          </div>
        </div>

        <div className="text-center text-xs opacity-75 border-t pt-1">
          {metrics.weekCount} games
        </div>
      </CardContent>
    </Card>
  );
};

const SeasonDivider: React.FC<{ season: string; isFirst?: boolean }> = ({ season, isFirst }) => (
  <div className={`flex flex-col items-center ${!isFirst ? 'ml-8' : ''} transition-all duration-300`}>
    <div className="h-16 w-px bg-gradient-to-b from-transparent to-gray-300"></div>
    <Badge
      variant="outline"
      className="text-xs font-bold bg-gradient-to-r from-blue-50 to-indigo-50 border-indigo-300
                 shadow-sm hover:shadow-md transition-all duration-200 hover:scale-105"
    >
      {season}
    </Badge>
    <div className="h-16 w-px bg-gradient-to-t from-transparent to-gray-300"></div>
  </div>
);

export default function PerformanceTimeline({ events, onEventClick }: PerformanceTimelineProps) {
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

  // Group events by season for visual organization
  const seasonSegments: SeasonSegment[] = [];
  let currentSeason = '';
  let currentSegment: SeasonSegment | null = null;

  sortedEvents.forEach((event, index) => {
    const eventSeason = event.season || 'Unknown';

    if (eventSeason !== currentSeason) {
      // Start new season segment
      if (currentSegment) {
        currentSegment.endIndex = index - 1;
        seasonSegments.push(currentSegment);
      }

      currentSeason = eventSeason;
      currentSegment = {
        season: eventSeason,
        events: [event],
        startIndex: index,
        endIndex: index
      };
    } else if (currentSegment) {
      currentSegment.events.push(event);
      currentSegment.endIndex = index;
    }
  });

  // Don't forget the last segment
  if (currentSegment) {
    seasonSegments.push(currentSegment);
  }

  return (
    <div className="w-full py-8">
      <ScrollArea className="w-full">
        <div className="relative px-8">
          {/* Main timeline line */}
          <div className="absolute top-1/2 left-0 right-0 h-1 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 transform -translate-y-1/2 rounded-full shadow-sm" />

          {/* Season backgrounds */}
          <div className="absolute inset-0 flex rounded-lg overflow-hidden">
            {seasonSegments.map((segment, segmentIndex) => (
              <div
                key={segment.season}
                className={`h-full transition-all duration-500 ${
                  segmentIndex % 2 === 0
                    ? 'bg-gradient-to-b from-slate-50/40 to-slate-100/60'
                    : 'bg-gradient-to-b from-blue-50/30 to-blue-100/50'
                }`}
                style={{
                  width: `${(segment.events.length / sortedEvents.length) * 100}%`,
                }}
              />
            ))}
          </div>

          {/* Events with performance metrics */}
          <div className="relative flex items-center gap-16 min-w-max">
            {sortedEvents.map((event, index) => {
              const isFirstInSeason = index === 0 ||
                (sortedEvents[index - 1]?.season !== event.season);

              return (
                <div key={event.id} className="relative flex flex-col items-center">
                  {/* Season divider for new seasons */}
                  {isFirstInSeason && event.season && (
                    <SeasonDivider season={event.season} isFirst={index === 0} />
                  )}

                  {/* Performance metrics cards above the event */}
                  {event.performanceMetrics && event.performanceMetrics.length > 0 && (
                    <div className="flex flex-col gap-2 mb-4">
                      {event.performanceMetrics.map((metrics, metricIndex) => (
                        <PerformanceMetricsCard
                          key={`${event.id}-${metrics.season}-${metricIndex}`}
                          metrics={metrics}
                        />
                      ))}
                    </div>
                  )}

                  {/* Event node */}
                  <TimelineEventNode
                    event={event}
                    onClick={onEventClick}
                  />

                  {/* Connection line to next event */}
                  {index < sortedEvents.length - 1 && (
                    <div className="absolute top-1/2 right-0 w-16 h-0.5 bg-gray-300 transform -translate-y-1/2 translate-x-full" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}