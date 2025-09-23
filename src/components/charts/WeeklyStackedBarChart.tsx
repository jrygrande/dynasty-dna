'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { WeeklyScore } from '@/services/roster';

interface WeeklyStackedBarChartProps {
  data: WeeklyScore[];
}

const ACQUISITION_COLORS = {
  trade: '#2563eb',
  draft: '#dc2626',
  waiver: '#16a34a',
  free_agency: '#ca8a04'
};

const formatAcquisitionType = (type: string): string => {
  switch (type) {
    case 'free_agency':
      return 'Free Agency';
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
};

export function WeeklyStackedBarChart({ data }: WeeklyStackedBarChartProps) {
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Weekly Scoring by Acquisition Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            No weekly data available
          </div>
        </CardContent>
      </Card>
    );
  }

  // Get all acquisition types from the data
  const acquisitionTypes = Array.from(
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
              {formatAcquisitionType(item.dataKey)}: {item.value.toFixed(1)} pts
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
        <CardTitle>Weekly Scoring by Acquisition Type</CardTitle>
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
              <Tooltip content={<CustomTooltip />} />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value) => (
                  <span className="text-sm">{formatAcquisitionType(value)}</span>
                )}
              />
              {acquisitionTypes.map((type) => (
                <Bar
                  key={type}
                  dataKey={type}
                  stackId="points"
                  fill={ACQUISITION_COLORS[type as keyof typeof ACQUISITION_COLORS] || '#6b7280'}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}