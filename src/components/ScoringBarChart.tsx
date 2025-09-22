'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';

interface Score {
  leagueId: string;
  season: string;
  week: number;
  points: number;
  isStarter: boolean;
  rosterId: number;
  position: number;
}

interface Transaction {
  id: string;
  leagueId: string;
  season: string | null;
  week: number | null;
  eventTime: string | null;
  eventType: string;
  details: any;
  transactionId: string | null;
  position: number;
}

interface SeasonBoundary {
  season: string;
  start: number;
  end: number;
}

interface ScoringBarChartProps {
  scores: Score[];
  transactions: Transaction[];
  seasonBoundaries: SeasonBoundary[];
  onTransactionClick?: (transaction: Transaction) => void;
}

interface ChartDataPoint {
  position: number;
  season: string;
  week: number;
  points: number;
  isStarter: boolean;
  hasTransaction: boolean;
  transactions: Transaction[];
  fill: string;
}

export default function ScoringBarChart({ scores, transactions, seasonBoundaries, onTransactionClick }: ScoringBarChartProps) {
  // Create a map of transactions by position for quick lookup
  const transactionsByPosition = new Map<number, Transaction[]>();
  transactions.forEach(transaction => {
    const existing = transactionsByPosition.get(transaction.position) || [];
    existing.push(transaction);
    transactionsByPosition.set(transaction.position, existing);
  });

  // Prepare chart data with continuous positioning
  const chartData: ChartDataPoint[] = scores.map(score => {
    const positionTransactions = transactionsByPosition.get(score.position) || [];
    const hasTransaction = positionTransactions.length > 0;

    return {
      position: score.position,
      season: score.season,
      week: score.week,
      points: score.points,
      isStarter: score.isStarter,
      hasTransaction,
      transactions: positionTransactions,
      // Use more subtle colors for background effect
      fill: hasTransaction
        ? '#dc2626' // Red for transaction weeks
        : score.isStarter
          ? 'rgba(34, 197, 94, 0.6)' // Semi-transparent green for starters
          : 'rgba(107, 114, 128, 0.4)' // Semi-transparent gray for bench
    };
  });

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as ChartDataPoint;
      return (
        <div className="bg-white p-3 border rounded shadow-lg">
          <p className="font-medium">{data.season} Season - Week {data.week}</p>
          <p className="text-sm text-gray-600">Position: {data.position}</p>
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
      onTransactionClick(point.transactions[0]);
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
          <div className="w-4 h-4 bg-green-500 opacity-60 rounded"></div>
          <span>Starter</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-500 opacity-40 rounded"></div>
          <span>Bench</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-red-600 rounded"></div>
          <span>Transaction Week</span>
        </div>
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

            {/* Add transaction markers as bold reference lines */}
            {chartData
              .filter(d => d.hasTransaction)
              .map(d => (
                <ReferenceLine
                  key={`transaction-${d.position}`}
                  x={d.position}
                  stroke="#dc2626"
                  strokeWidth={3}
                />
              ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}