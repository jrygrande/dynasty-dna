"use client";

import { useState } from "react";

interface SlotBreakdown {
  followedGood: number;
  followedBad: number;
  brokeGood: number;
  brokeBad: number;
}

interface WeekData {
  week: number;
  score: number;
  actualPoints: number;
  optimalPoints: number;
  efficiency: number;
  pointsLeftOnBench: number;
  slotBreakdown: SlotBreakdown;
}

export interface RosterGrade {
  rosterId: number;
  ownerId: string;
  displayName: string;
  score: number;
  efficiency: number;
  totalPointsLeftOnBench: number;
  perfectWeeks: number;
  insightfulStarts: number;
  grade: string;
  weeks: WeekData[];
}

interface LineupEfficiencyCardProps {
  rosters: RosterGrade[];
}

const PARENT_COLUMN_COUNT = 7; // Manager, Grade, Efficiency, Pts Left, Perfect Wks, Insights, expand arrow

import { GradeBadge } from "@/components/GradeBadge";
import { ManagerName } from "@/components/ManagerName";

function RosterRow({ roster }: { roster: RosterGrade }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="border-t hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3">
          <span className="font-medium">
            <ManagerName
              userId={roster.ownerId}
              rosterId={roster.rosterId}
              displayName={roster.displayName}
              variant="display-only"
            />
          </span>
        </td>
        <td className="px-4 py-3 text-center">
          <GradeBadge grade={roster.grade} />
        </td>
        <td className="px-4 py-3 text-right font-mono text-sm">
          {roster.efficiency.toFixed(1)}%
        </td>
        <td className="px-4 py-3 text-right font-mono text-sm">
          {roster.totalPointsLeftOnBench.toFixed(1)}
        </td>
        <td className="px-4 py-3 text-right font-mono text-sm">
          {roster.perfectWeeks}
        </td>
        <td className="px-4 py-3 text-right font-mono text-sm">
          {roster.insightfulStarts}
        </td>
        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
          {expanded ? "▲" : "▼"}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={PARENT_COLUMN_COUNT} className="px-4 py-2 bg-muted/10">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1">Week</th>
                    <th className="px-2 py-1 text-right">Score</th>
                    <th className="px-2 py-1 text-right">Actual</th>
                    <th className="px-2 py-1 text-right">Optimal</th>
                    <th className="px-2 py-1 text-right">Eff%</th>
                    <th className="px-2 py-1 text-right">PLB</th>
                    <th className="px-2 py-1 text-right">Smart+Good</th>
                    <th className="px-2 py-1 text-right">Smart+Bad</th>
                    <th className="px-2 py-1 text-right">Insight</th>
                    <th className="px-2 py-1 text-right">Bad Call</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.weeks.map((w) => (
                    <tr
                      key={w.week}
                      className="border-t border-muted/30"
                    >
                      <td className="px-2 py-1 font-mono">{w.week}</td>
                      <td className="px-2 py-1 text-right font-mono">
                        {w.score.toFixed(1)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {w.actualPoints.toFixed(1)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {w.optimalPoints.toFixed(1)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {w.efficiency.toFixed(1)}%
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {w.pointsLeftOnBench.toFixed(1)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {w.slotBreakdown.followedGood}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {w.slotBreakdown.followedBad}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-grade-a">
                        {w.slotBreakdown.brokeGood}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-grade-f">
                        {w.slotBreakdown.brokeBad}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function LineupEfficiencyCard({ rosters }: LineupEfficiencyCardProps) {
  const sorted = [...rosters].sort((a, b) => b.efficiency - a.efficiency);

  if (sorted.length === 0) {
    return null;
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-4">Lineup Efficiency</h2>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr className="text-left text-sm">
              <th className="px-4 py-3 font-medium">Manager</th>
              <th className="px-4 py-3 font-medium text-center">Grade</th>
              <th className="px-4 py-3 font-medium text-right">Efficiency</th>
              <th className="px-4 py-3 font-medium text-right">Pts Left</th>
              <th className="px-4 py-3 font-medium text-right">Perfect Wks</th>
              <th className="px-4 py-3 font-medium text-right">Insights</th>
              <th className="px-4 py-3 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((roster) => (
              <RosterRow key={roster.rosterId} roster={roster} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
