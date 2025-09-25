'use client';

import React from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import type { TimelineEvent } from '@/lib/api/assets';
import TransactionTimeline from './TransactionTimeline';
import { useIsMobile } from '@/hooks/useIsMobile';

interface Score {
  leagueId: string;
  season: string;
  week: number;
  points: number;
  isStarter: boolean;
  rosterId: number;
  position: number;
  ownerName: string;
  ownerId?: string;
}

interface TransactionWithPosition extends TimelineEvent {
  position: number;
}

interface SeasonBoundary {
  season: string;
  start: number;
  end: number;
}

interface RosterLegendItem {
  rosterId: number;
  ownerName: string;
  ownerId?: string;
}

interface WeeklyBenchmark {
  season: string;
  week: number;
  position: number;
  median: number;
  topDecile: number;
  sampleSize: number;
}

interface ScoringBarChartProps {
  scores: Score[];
  transactions: TransactionWithPosition[];
  seasonBoundaries: SeasonBoundary[];
  rosterLegend: RosterLegendItem[];
  benchmarks?: WeeklyBenchmark[];
  playerPosition?: string;
  openTransactions: Set<string>;
  onTransactionToggle?: (transaction: TimelineEvent) => void;
  playerId?: string;
}

interface ChartDataPoint {
  position: number;
  season: string;
  week: number;
  points: number;
  isStarter: boolean;
  rosterId: number;
  ownerName: string;
  ownerId?: string;
  hasTransaction: boolean;
  transactions: TransactionWithPosition[];
  fill: string;
  median?: number;
  topDecile?: number;
}

export default function ScoringBarChart({ scores, transactions, seasonBoundaries, rosterLegend, benchmarks = [], playerPosition, openTransactions, onTransactionToggle, playerId }: ScoringBarChartProps) {
  const chartContainerRef = React.useRef<HTMLDivElement>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const [chartDimensions, setChartDimensions] = React.useState({ width: 800, height: 384 });
  const isMobile = useIsMobile();

  // Track chart container size changes for timeline alignment
  React.useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setChartDimensions({ width, height });
      }
    });

    resizeObserver.observe(container);

    // Set initial dimensions
    const rect = container.getBoundingClientRect();
    setChartDimensions({ width: rect.width, height: rect.height });

    return () => {
      resizeObserver.disconnect();
    };
  }, []);


  // Create a color palette for different roster IDs
  const generateRosterColor = (rosterId: number): string => {
    const colors = [
      '#3b82f6', // Blue
      '#10b981', // Emerald
      '#f59e0b', // Amber
      '#ef4444', // Red
      '#8b5cf6', // Violet
      '#06b6d4', // Cyan
      '#84cc16', // Lime
      '#f97316', // Orange
      '#ec4899', // Pink
      '#6366f1', // Indigo
    ];
    return colors[rosterId % colors.length];
  };

  // Create a map of transactions by position for quick lookup
  const transactionsByPosition = new Map<number, TransactionWithPosition[]>();
  transactions.forEach(transaction => {
    const existing = transactionsByPosition.get(transaction.position) || [];
    existing.push(transaction);
    transactionsByPosition.set(transaction.position, existing);
  });

  // Create a map of benchmarks by position for quick lookup
  const benchmarksByPosition = new Map<number, { median: number; topDecile: number }>();
  benchmarks.forEach(benchmark => {
    benchmarksByPosition.set(benchmark.position, {
      median: benchmark.median,
      topDecile: benchmark.topDecile
    });
  });

  // Calculate recent seasons for mobile view
  const recentSeasonsData = React.useMemo(() => {
    if (!isMobile || seasonBoundaries.length === 0) {
      return { minPosition: 1, maxPosition: Math.max(...scores.map(s => s.position)) };
    }

    // Get the last 2 seasons (current + 1 previous)
    const sortedBoundaries = seasonBoundaries
      .sort((a, b) => parseInt(b.season) - parseInt(a.season))
      .slice(0, 2);

    if (sortedBoundaries.length === 0) {
      return { minPosition: 1, maxPosition: Math.max(...scores.map(s => s.position)) };
    }

    const startPosition = sortedBoundaries.length === 2
      ? sortedBoundaries[1].start
      : sortedBoundaries[0].start;
    const endPosition = sortedBoundaries[0].end;

    return {
      minPosition: startPosition,
      maxPosition: endPosition
    };
  }, [isMobile, seasonBoundaries, scores]);

  // Prepare chart data with roster-based coloring and benchmark data
  const chartData: ChartDataPoint[] = scores.map(score => {
    const positionTransactions = transactionsByPosition.get(score.position) || [];
    const hasTransaction = positionTransactions.length > 0;
    const benchmarkData = benchmarksByPosition.get(score.position);

    return {
      position: score.position,
      season: score.season,
      week: score.week,
      points: score.points,
      isStarter: score.isStarter,
      rosterId: score.rosterId,
      ownerName: score.ownerName,
      ownerId: score.ownerId,
      hasTransaction,
      transactions: positionTransactions,
      // Use roster-based colors: grey for bench, roster color for starters
      fill: score.isStarter
        ? generateRosterColor(score.rosterId)
        : 'rgba(107, 114, 128, 0.4)', // Grey for bench
      median: benchmarkData?.median,
      topDecile: benchmarkData?.topDecile
    };
  });

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as ChartDataPoint;
      return (
        <div className="bg-white p-3 border rounded shadow-lg">
          <p className="font-medium">{data.season} Season - Week {data.week}</p>
          <p className="text-sm text-gray-600">Team: {data.ownerName}</p>
          <p className="text-sm">
            <span className="font-medium">{data.points.toFixed(1)} points</span>
            <span className="ml-2 text-xs">
              ({data.isStarter ? 'Starter' : 'Bench'})
            </span>
          </p>
          {data.hasTransaction && (
            <p className="text-xs text-red-600 mt-1">
              {data.transactions.length} transaction{data.transactions.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  const handleBarClick = (data: any) => {
    const point = data as ChartDataPoint;
    if (point.hasTransaction && onTransactionToggle) {
      // For simplicity, just toggle the first transaction
      // Could be enhanced to show a list if multiple transactions
      const transaction = point.transactions[0];
      // Remove the position property to pass clean TimelineEvent
      const { position, ...timelineEvent } = transaction;
      onTransactionToggle(timelineEvent);
    }
  };

  // Filter chart data for mobile view (show recent seasons by default)
  const visibleChartData = React.useMemo(() => {
    if (!isMobile) return chartData;
    return chartData.filter(d =>
      d.position >= recentSeasonsData.minPosition &&
      d.position <= recentSeasonsData.maxPosition
    );
  }, [chartData, isMobile, recentSeasonsData]);

  // Calculate chart width for mobile scrolling
  const chartWidth = React.useMemo(() => {
    if (!isMobile) return '100%';
    // Calculate width based on total data points to ensure all data is visible
    const dataPointWidth = 12; // pixels per position for better readability
    const totalWidth = Math.max(800, chartData.length * dataPointWidth);
    return totalWidth;
  }, [isMobile, chartData.length]);

  // Calculate overall max points for consistent scale
  const maxPoints = Math.max(...chartData.map(d => d.points));

  // Calculate horizontal reference line values
  const referenceLines = React.useMemo(() => {
    // High line: Max of player scores or elite benchmark, rounded up to nearest 5
    const maxBenchmark = benchmarks.length > 0 ? Math.max(...benchmarks.map(b => b.topDecile || 0)) : 0;
    const highLineValue = Math.ceil(Math.max(maxPoints, maxBenchmark) / 5) * 5;

    // Middle line: Average of median benchmarks, rounded to nearest 5
    const avgMedian = benchmarks.length > 0
      ? benchmarks.reduce((sum, b) => sum + (b.median || 0), 0) / benchmarks.length
      : maxPoints * 0.4;
    const middleLineValue = Math.round(avgMedian / 5) * 5;

    // Top line: Higher reference for elite performances (about 1.5x the high benchmark)
    const topLineValue = Math.ceil((highLineValue * 1.3) / 5) * 5;

    return [
      { value: topLineValue, opacity: 0.5 },
      { value: highLineValue, opacity: 0.4 },
      { value: middleLineValue, opacity: 0.4 }
    ];
  }, [maxPoints, benchmarks]);

  // Auto-scroll to recent seasons on mobile
  React.useEffect(() => {
    if (isMobile && scrollContainerRef.current && chartData.length > 0) {
      const container = scrollContainerRef.current;
      // Small delay to ensure chart is rendered
      const timeout = setTimeout(() => {
        // Scroll to show recent seasons (rightmost area)
        const scrollPosition = container.scrollWidth - container.clientWidth;
        container.scrollLeft = Math.max(0, scrollPosition);
      }, 100);

      return () => clearTimeout(timeout);
    }
  }, [isMobile, chartData, recentSeasonsData]);

  // Create season boundary tick marks for X-axis aligned with season starts
  const seasonTicks = seasonBoundaries.map(boundary => ({
    position: boundary.start,
    season: boundary.season
  }));

  if (chartData.length === 0) {
    return (
      <div className="w-full h-96 flex items-center justify-center text-gray-500">
        <p>No scoring data available</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-4 space-y-2">
        {/* Player/Team Legend */}
        <div className={`flex gap-4 text-sm ${
          isMobile ? 'flex-wrap gap-2 text-xs' : 'flex-wrap gap-4'
        }`}>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-500 opacity-40 rounded"></div>
            <span>Bench</span>
          </div>
          {rosterLegend.map((roster) => (
            <div key={roster.rosterId} className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded"
                style={{ backgroundColor: generateRosterColor(roster.rosterId) }}
              ></div>
              <span>{roster.ownerName}</span>
            </div>
          ))}
        </div>

        {/* Benchmark Legend */}
        {benchmarks.length > 0 && playerPosition && (
          <div className={`flex flex-wrap gap-2 border-t pt-2 ${
            isMobile ? 'text-xs' : 'gap-4 text-sm'
          }`}>
            <div className="font-medium text-gray-700 mr-2">
              {playerPosition} Benchmarks:
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-0.5 bg-amber-500"></div>
              <span>Median</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-0.5 bg-emerald-500"></div>
              <span>Elite</span>
            </div>
          </div>
        )}
      </div>

      <div
        ref={scrollContainerRef}
        className={`w-full ${
          isMobile ? 'overflow-x-auto scrollbar-thin scrollbar-thumb-gray-300' : ''
        }`}
        style={isMobile ? {
          background: 'linear-gradient(to right, transparent 0%, white 5%, white 95%, transparent 100%)'
        } : {}}
      >
        <div
          ref={chartContainerRef}
          className={isMobile ? 'h-64' : 'w-full h-96'}
          style={isMobile ? { width: chartWidth } : {}}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={isMobile ? { top: 20, right: 15, left: 15, bottom: 40 } : { top: 20, right: 30, left: 20, bottom: 60 }}
            >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e5e7eb"
              strokeOpacity={isMobile ? 0 : 0.1}
            />

            <XAxis
              dataKey="position"
              type="number"
              scale="linear"
              domain={['dataMin', 'dataMax']}
              ticks={seasonTicks.map(t => t.position)}
              tickFormatter={(value) => {
                const seasonTick = seasonTicks.find(t => t.position === value);
                return seasonTick ? seasonTick.season : '';
              }}
              label={{ value: 'Season', position: 'insideBottom', offset: -10 }}
              interval={0}
            />

            <YAxis
              domain={[0, Math.ceil(maxPoints * 1.1)]}
              tick={false}
              axisLine={false}
              tickLine={false}
            />

            <Tooltip content={<CustomTooltip />} />

            <Bar
              dataKey="points"
              onClick={handleBarClick}
              style={{ cursor: 'pointer' }}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Bar>

            {/* Add smooth benchmark lines */}
            <Line
              type="monotone"
              dataKey="median"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="topDecile"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />

            {/* Add horizontal reference lines */}
            {referenceLines.map((line, index) => (
              <ReferenceLine
                key={`horizontal-ref-${index}`}
                y={line.value}
                stroke={`rgba(107, 114, 128, ${line.opacity})`}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                label={{
                  value: line.value,
                  position: "insideTopRight",
                  style: {
                    textAnchor: 'end',
                    fill: 'rgba(75, 85, 99, 0.8)',
                    fontSize: '11px',
                    fontWeight: 'bold'
                  }
                }}
              />
            ))}

            {/* Add season boundary lines between seasons */}
            {seasonBoundaries.slice(1).map(boundary => (
              <ReferenceLine
                key={`season-${boundary.season}`}
                x={boundary.start - 0.5}
                stroke="rgba(148, 163, 184, 0.6)"
                strokeWidth={2}
                strokeDasharray="4 4"
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
        </div>

        {/* Transaction Timeline */}
        <TransactionTimeline
        transactions={(() => {
          // Filter transactions to avoid overlapping nodes for the same transaction
          // For trade transactions, prefer 'trade' and 'pick_trade' events over 'add'/'drop' events
          const transactionGroups = new Map<string, TransactionWithPosition[]>();

          // Group by transactionId AND playerId to handle multiple players in same transaction
          transactions.forEach(transaction => {
            const playerId = transaction.assetsInTransaction?.[0]?.playerId || 'no-player';
            const key = transaction.transactionId
              ? `${transaction.transactionId}-${playerId}`
              : `${transaction.eventType}-${transaction.position}`;
            if (!transactionGroups.has(key)) {
              transactionGroups.set(key, []);
            }
            transactionGroups.get(key)!.push(transaction);
          });

          // For each group, select the best representative event
          const filteredTransactions: TransactionWithPosition[] = [];
          transactionGroups.forEach(group => {
            if (group.length === 1) {
              // Single event, just include it
              filteredTransactions.push(group[0]);
            } else {
              // Multiple events for same transaction - prioritize trade events
              const tradeEvent = group.find(t => t.eventType === 'trade' || t.eventType === 'pick_trade');
              if (tradeEvent) {
                filteredTransactions.push(tradeEvent);
              } else {
                // No trade event, just pick the first one
                filteredTransactions.push(group[0]);
              }
            }
          });

          return filteredTransactions;
        })()}
        chartWidth={chartDimensions.width}
        chartMargin={isMobile ? { left: 15, right: 15 } : { left: 20, right: 30 }}
        maxPosition={Math.max(...chartData.map(d => d.position))}
        minPosition={Math.min(...chartData.map(d => d.position))}
        openTransactions={openTransactions}
        onTransactionToggle={onTransactionToggle}
        playerId={playerId}
      />
      </div>
    </div>
  );
}