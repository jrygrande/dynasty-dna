'use client';

import React from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, ReferenceDot } from 'recharts';
import type { TimelineEvent } from '@/lib/api/assets';
import TransactionDot from './TransactionDot';
import TransactionPopup from './TransactionPopup';
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
  isPhantom?: boolean; // For transaction positions without score data
}

export default function ScoringBarChart({ scores, transactions, seasonBoundaries, rosterLegend, benchmarks = [], playerPosition, openTransactions, onTransactionToggle, playerId }: ScoringBarChartProps) {
  const chartContainerRef = React.useRef<HTMLDivElement>(null);
  const [chartDimensions, setChartDimensions] = React.useState({ width: 800, height: 384 });
  const [activeTransactions, setActiveTransactions] = React.useState<Array<{
    transaction: TimelineEvent;
    position: { x: number; y: number };
  }>>([]);
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

  // Deduplicate transactions with same transactionId (e.g., trade creates add/drop/trade events)
  const deduplicatedTransactions = transactions.reduce((acc, transaction) => {
    if (!transaction.transactionId) {
      // No transactionId, keep as-is
      acc.push(transaction);
    } else {
      // Check if we already have a transaction with this ID
      const existingIndex = acc.findIndex(t => t.transactionId === transaction.transactionId);
      if (existingIndex === -1) {
        acc.push(transaction);
      } else {
        // Prefer trade events over add/drop events for better representation
        const existing = acc[existingIndex];
        if (transaction.eventType === 'trade' ||
            (transaction.eventType === 'pick_trade' && existing.eventType !== 'trade')) {
          acc[existingIndex] = transaction;
        }
        // Keep existing if it's already a trade event or higher priority
      }
    }
    return acc;
  }, [] as TransactionWithPosition[]);

  // Create a map of transactions by position for quick lookup
  const transactionsByPosition = new Map<number, TransactionWithPosition[]>();
  deduplicatedTransactions.forEach(transaction => {
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


  // Prepare chart data with roster-based coloring and benchmark data
  const baseChartData: ChartDataPoint[] = scores.map(score => {
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
      topDecile: benchmarkData?.topDecile,
      isPhantom: false
    };
  });

  // Add phantom data points for transactions that don't have corresponding scores
  const existingPositions = new Set(scores.map(s => s.position));
  const phantomDataPoints: ChartDataPoint[] = deduplicatedTransactions
    .filter(transaction => !existingPositions.has(transaction.position))
    .reduce((phantoms: ChartDataPoint[], transaction) => {
      // Group transactions by position to avoid duplicates
      const existingPhantom = phantoms.find(p => p.position === transaction.position);
      if (existingPhantom) {
        existingPhantom.transactions.push(transaction);
      } else {
        // Find season boundary for this position
        const seasonBoundary = seasonBoundaries.find(boundary =>
          transaction.position >= boundary.start && transaction.position <= boundary.end
        );

        phantoms.push({
          position: transaction.position,
          season: seasonBoundary?.season || 'Unknown',
          week: transaction.week || 0,
          points: 0, // Phantom points
          isStarter: false,
          rosterId: transaction.toRosterId || 0,
          ownerName: transaction.toUser?.displayName || transaction.toUser?.name || 'Unknown',
          ownerId: transaction.toUser?.id || undefined,
          hasTransaction: true,
          transactions: [transaction],
          fill: 'rgba(107, 114, 128, 0.05)', // Nearly invisible
          isPhantom: true
        });
      }
      return phantoms;
    }, []);

  // Combine base data with phantom data and sort by position
  const chartData: ChartDataPoint[] = [...baseChartData, ...phantomDataPoints]
    .sort((a, b) => a.position - b.position);

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
        </div>
      );
    }
    return null;
  };

  const handleTransactionClick = (transaction: TransactionWithPosition, dotPosition: { cx: number; cy: number }) => {
    setActiveTransactions(prev => {
      // Check if this transaction popup is already open
      const isTransactionOpen = prev.some(item => item.transaction.id === transaction.id);

      if (isTransactionOpen) {
        // If it's open, remove it
        return prev.filter(item => item.transaction.id !== transaction.id);
      } else {
        // If not, add the new transaction with its position
        return [...prev, {
          transaction: { ...transaction },
          position: { x: dotPosition.cx, y: dotPosition.cy }
        }];
      }
    });
  };

  const handleClosePopup = (transactionId: string) => {
    setActiveTransactions(prev => prev.filter(item => item.transaction.id !== transactionId));
  };

  const handleBarClick = (data: any) => {
    // Bar clicks will be handled by ReferenceDot clicks instead
    // This can be removed once we fully migrate to ReferenceDot approach
  };

  // Use full chart data - no filtering needed since we show complete chart
  const visibleChartData = chartData;

  // Calculate chart size for mobile scrolling
  const chartSize = React.useMemo(() => {
    if (!isMobile) return { width: '100%', height: '100%' };

    // For mobile vertical layout:
    // - Fixed width (viewport)
    // - Height based on data points for vertical scrolling
    const dataPointHeight = 8; // pixels per position for vertical layout
    const totalHeight = Math.max(600, chartData.length * dataPointHeight);

    return {
      width: '100%', // Fixed width on mobile
      height: totalHeight
    };
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
        ref={chartContainerRef}
        className="w-full"
        style={isMobile ? { height: chartSize.height } : { height: '24rem' }}
      >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={isMobile ? { top: 20, right: 40, left: 20, bottom: 20 } : { top: 20, right: 30, left: 20, bottom: 60 }}
              layout={isMobile ? 'vertical' : 'horizontal'}
            >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e5e7eb"
              strokeOpacity={isMobile ? 0 : 0.1}
            />

            {isMobile ? (
              // Mobile vertical layout: X = points, Y = position/time
              <>
                <XAxis
                  type="number"
                  domain={[0, Math.ceil(maxPoints * 1.1)]}
                  tick={false}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  dataKey="position"
                  type="number"
                  scale="linear"
                  domain={['dataMin', 'dataMax']}
                  ticks={seasonTicks.map(t => t.position)}
                  tickFormatter={(value) => {
                    const seasonTick = seasonTicks.find(t => t.position === value);
                    return seasonTick ? seasonTick.season : '';
                  }}
                  interval={0}
                />
              </>
            ) : (
              // Desktop horizontal layout: X = position/time, Y = points
              <>
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
              </>
            )}

            <Tooltip content={<CustomTooltip />} />

            <Bar dataKey="points">
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Bar>

            {/* Add ReferenceDot for each transaction */}
            {chartData
              .filter(dataPoint => dataPoint.hasTransaction && dataPoint.transactions)
              .flatMap(dataPoint =>
                dataPoint.transactions!.map((transaction, transIndex) => (
                  <ReferenceDot
                    key={`transaction-${transaction.id}-${transIndex}`}
                    x={isMobile ? dataPoint.points : dataPoint.position}
                    y={isMobile ? dataPoint.position : dataPoint.points}
                    shape={(props: any) => (
                      <TransactionDot
                        {...props}
                        onEventClick={handleTransactionClick}
                        transaction={transaction}
                      />
                    )}
                  />
                ))
              )}

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

            {/* Add reference lines (horizontal on desktop, vertical on mobile) */}
            {referenceLines.map((line, index) => (
              <ReferenceLine
                key={`ref-${index}`}
                {...(isMobile ? { x: line.value } : { y: line.value })}
                stroke={`rgba(107, 114, 128, ${line.opacity})`}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                label={{
                  value: line.value,
                  position: isMobile ? "insideTopRight" : "insideTopRight",
                  style: {
                    textAnchor: isMobile ? 'start' : 'end',
                    fill: 'rgba(75, 85, 99, 0.8)',
                    fontSize: '11px',
                    fontWeight: 'bold'
                  }
                }}
              />
            ))}

            {/* Add season boundary lines (vertical on desktop, horizontal on mobile) */}
            {seasonBoundaries.slice(1).map(boundary => (
              <ReferenceLine
                key={`season-${boundary.season}`}
                {...(isMobile ? { y: boundary.start - 0.5 } : { x: boundary.start - 0.5 })}
                stroke="rgba(148, 163, 184, 0.6)"
                strokeWidth={2}
                strokeDasharray="4 4"
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
        </div>

        {/* Transaction Popup Overlays */}
        {activeTransactions.map((item) => {
          // Calculate smart positioning to keep cards in bounds
          const chartRect = chartContainerRef.current?.getBoundingClientRect();
          const cardWidth = 320; // max-w-sm ~= 320px
          const cardHeight = 200; // estimated height

          // Determine if card should appear above or below dot
          const spaceAbove = item.position.y;
          const spaceBelow = chartRect ? chartRect.height - item.position.y : 300;
          const preferAbove = spaceAbove > cardHeight + 20;

          // Determine horizontal positioning
          const spaceLeft = item.position.x;
          const spaceRight = chartRect ? chartRect.width - item.position.x : 400;

          let xOffset = '-50%'; // default center
          if (spaceLeft < cardWidth / 2) {
            xOffset = '0%'; // align left edge to dot
          } else if (spaceRight < cardWidth / 2) {
            xOffset = '-100%'; // align right edge to dot
          }

          const yTransform = preferAbove ? '-100%' : '20px';

          return (
            <div
              key={item.transaction.id}
              className="absolute z-50 pointer-events-none"
              style={{
                left: item.position.x,
                top: item.position.y,
                transform: `translate(${xOffset}, ${yTransform})`
              }}
            >
            <div className="pointer-events-auto">
              <TransactionPopup
                event={item.transaction}
                xPosition={item.position.x}
                onClose={() => handleClosePopup(item.transaction.id)}
                playerId={playerId}
              />
            </div>
          </div>
          );
        })}
    </div>
  );
}