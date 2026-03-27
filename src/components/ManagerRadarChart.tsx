"use client";

import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from "recharts";

import { PILLAR_LABELS } from "@/lib/pillars";

interface ManagerRadarChartProps {
  pillarScores: Record<string, { value: number; grade: string; percentile: number } | null>;
}

export function ManagerRadarChart({ pillarScores }: ManagerRadarChartProps) {
  const data = Object.entries(PILLAR_LABELS).map(([key, label]) => ({
    pillar: label,
    score: pillarScores[key]?.value ?? 0,
    fullMark: 100,
  }));

  const hasData = data.some((d) => d.score > 0);
  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        No grading data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart cx="50%" cy="50%" outerRadius="75%" data={data}>
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis
          dataKey="pillar"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
          tickCount={5}
        />
        <Radar
          name="Score"
          dataKey="score"
          stroke="hsl(var(--primary))"
          fill="hsl(var(--primary))"
          fillOpacity={0.2}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
