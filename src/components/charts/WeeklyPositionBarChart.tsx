'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { WeeklyPositionScore } from '@/services/roster';

interface WeeklyPositionBarChartProps {
  data: WeeklyPositionScore[];
}

const POSITION_COLORS = {
  QB: '#3b82f6', // Blue
  RB: '#ef4444', // Red
  WR: '#10b981', // Green
  TE: '#f59e0b', // Amber
  K: '#8b5cf6',  // Purple
  DEF: '#6b7280' // Gray
};

export function WeeklyPositionBarChart({ data }: WeeklyPositionBarChartProps) {
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Weekly Scoring by Position</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            No weekly data available
          </div>
        </CardContent>
      </Card>
    );
  }

  // Get all positions from the data
  const positions = Array.from(
    new Set(
      data.flatMap(week =>
        Object.keys(week).filter(key => key !== 'week')
      )
    )
  ).sort();

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    const total = payload.reduce((sum: number, item: any) => sum + item.value, 0);

    return (
      <div className="bg-white p-3 border rounded-lg shadow-lg">
        <p className="font-semibold mb-2">Week {label}</p>
        {payload
          .filter((item: any) => item.value > 0)
          .sort((a: any, b: any) => b.value - a.value)
          .map((item: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: item.color }}>
              {item.dataKey}: {item.value.toFixed(1)} pts
            </p>
          ))}
        <div className="border-t pt-2 mt-2">
          <p className="text-sm font-medium">Total: {total.toFixed(1)} pts</p>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly Scoring by Position</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 12 }}
                tickFormatter={(value) => `W${value}`}
              />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip content={<CustomTooltip />} cursor={false} />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value) => (
                  <span className="text-sm">{value}</span>
                )}
              />
              {positions.map((position) => (
                <Bar
                  key={position}
                  dataKey={position}
                  stackId="points"
                  fill={POSITION_COLORS[position as keyof typeof POSITION_COLORS] || '#6b7280'}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}