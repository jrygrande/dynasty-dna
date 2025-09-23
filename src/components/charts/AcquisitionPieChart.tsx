'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AcquisitionTypeStats } from '@/services/roster';

interface AcquisitionPieChartProps {
  data: Record<string, AcquisitionTypeStats>;
}

const ACQUISITION_COLORS = {
  trade: '#9333ea',
  draft_selected: '#16a34a',
  waiver_add: '#ea580c',
  free_agency: '#eab308'
};

const formatAcquisitionType = (type: string): string => {
  switch (type) {
    case 'free_agency':
      return 'Free Agency';
    case 'draft_selected':
      return 'Draft';
    case 'waiver_add':
      return 'Waiver';
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
};

export function AcquisitionPieChart({ data }: AcquisitionPieChartProps) {
  const chartData = Object.entries(data)
    .filter(([_, stats]) => stats.points > 0)
    .map(([type, stats]) => ({
      name: formatAcquisitionType(type),
      value: stats.points,
      ppg: stats.ppg,
      rank: stats.rank,
      totalTeams: stats.totalTeams,
      color: ACQUISITION_COLORS[type as keyof typeof ACQUISITION_COLORS] || '#6b7280'
    }));

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0].payload;
    return (
      <div className="bg-white p-3 border rounded-lg shadow-lg">
        <p className="font-semibold">{data.name}</p>
        <p className="text-sm text-muted-foreground">
          {data.ppg.toFixed(1)} PPG (#{data.rank}/{data.totalTeams})
        </p>
        <p className="text-sm text-muted-foreground">
          {data.value.toFixed(1)} total points
        </p>
      </div>
    );
  };

  const CustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value, name }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    const percentage = ((value / chartData.reduce((sum, item) => sum + item.value, 0)) * 100);

    if (percentage < 8) return null; // Hide labels for small slices

    return (
      <text
        x={x}
        y={y}
        fill="white"
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        className="text-xs font-medium"
      >
        {`${percentage.toFixed(0)}%`}
      </text>
    );
  };

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Starter Points by Acquisition Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            No data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Starter Points by Acquisition Type</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={CustomLabel}
                outerRadius={100}
                innerRadius={50}
                fill="#8884d8"
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value) => <span className="text-sm">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}