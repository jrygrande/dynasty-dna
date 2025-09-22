'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, LabelList } from 'recharts';
import type { TimelineEvent } from '@/lib/api/assets';

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

interface ScoringBarChartProps {
  scores: Score[];
  transactions: TransactionWithPosition[];
  seasonBoundaries: SeasonBoundary[];
  rosterLegend: RosterLegendItem[];
  onTransactionClick?: (transaction: TimelineEvent) => void;
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
}

export default function ScoringBarChart({ scores, transactions, seasonBoundaries, rosterLegend, onTransactionClick }: ScoringBarChartProps) {
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

  // Prepare chart data with roster-based coloring
  const chartData: ChartDataPoint[] = scores.map(score => {
    const positionTransactions = transactionsByPosition.get(score.position) || [];
    const hasTransaction = positionTransactions.length > 0;

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
        : 'rgba(107, 114, 128, 0.4)' // Grey for bench
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
    if (point.hasTransaction && onTransactionClick) {
      // For simplicity, just click on the first transaction
      // Could be enhanced to show a list if multiple transactions
      const transaction = point.transactions[0];
      // Remove the position property to pass clean TimelineEvent
      const { position, ...timelineEvent } = transaction;
      onTransactionClick(timelineEvent);
    }
  };

  // Calculate overall max points for consistent scale
  const maxPoints = Math.max(...chartData.map(d => d.points));

  // Create season boundary tick marks for X-axis
  const seasonTicks = seasonBoundaries.map(boundary => ({
    position: Math.floor((boundary.start + boundary.end) / 2),
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
      <div className="mb-4 flex flex-wrap gap-4 text-sm">
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

      <div className="w-full h-96">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />

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
              label={{ value: 'Points', angle: -90, position: 'insideLeft' }}
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
              <LabelList
                dataKey="hasTransaction"
                content={({ x, y, width, value, payload }) => {
                  if (!value || !payload) return null;
                  const data = payload as ChartDataPoint;
                  if (!data.hasTransaction) return null;
                  return (
                    <text
                      x={Number(x) + Number(width) / 2}
                      y={Number(y) - 8}
                      textAnchor="middle"
                      fill="#dc2626"
                      fontSize="14"
                      fontWeight="bold"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (data.hasTransaction && onTransactionClick && data.transactions?.length > 0) {
                          const transaction = data.transactions[0];
                          const { position, ...timelineEvent } = transaction;
                          onTransactionClick(timelineEvent);
                        }
                      }}
                    >
                      ●
                    </text>
                  );
                }}
              />
            </Bar>

            {/* Add season boundary lines */}
            {seasonBoundaries.map(boundary => (
              <ReferenceLine
                key={`season-${boundary.season}`}
                x={boundary.start}
                stroke="#94a3b8"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}