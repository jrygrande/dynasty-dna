import { Info } from "lucide-react";
import { GradeBadge } from "@/components/GradeBadge";
import { PILLAR_LABELS } from "@/lib/pillars";
import { ordinal } from "@/lib/utils";

export interface ManagerScore {
  value: number;
  grade: string;
  percentile: number;
  rank: number;
  total: number;
}

interface ManagerGradeCardProps {
  mps: ManagerScore | null;
  pillarScores: Record<string, ManagerScore | null>;
}

const MPS_TOOLTIP =
  "Manager Process Score: A weighted average of your drafting, trading, waiver, and lineup grades — with the moves that have the biggest impact considered most by the model.";

export function ManagerGradeCard({
  mps,
  pillarScores,
}: ManagerGradeCardProps) {
  if (!mps) {
    return (
      <div className="border rounded-lg p-6 text-center text-muted-foreground text-sm">
        No Manager Process Score yet — sync league data to generate grades
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-4 sm:p-6">
      <div className="flex items-baseline gap-2 mb-1">
        <h2 className="text-sm font-semibold">Manager Process Score</h2>
        <span
          className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground cursor-help"
          title={MPS_TOOLTIP}
        >
          MPS
          <Info className="h-3 w-3" aria-hidden />
          <span className="sr-only">{MPS_TOOLTIP}</span>
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Rank within your league
      </p>

      <div className="flex items-center gap-4 mb-6">
        <div className="text-4xl sm:text-5xl font-bold font-mono tabular-nums">
          {ordinal(mps.rank)}
        </div>
        <div>
          <GradeBadge grade={mps.grade} size="sm" />
          <div className="text-xs text-muted-foreground mt-1 font-mono">
            of {mps.total}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
        {Object.entries(PILLAR_LABELS).map(([key, label]) => {
          const pillar = pillarScores[key];
          return (
            <div
              key={key}
              className="flex items-center justify-between border rounded px-3 py-2 gap-2 min-w-0"
            >
              <span className="text-sm text-muted-foreground truncate">
                {label}
              </span>
              {pillar ? (
                <GradeBadge grade={pillar.grade} size="xs" />
              ) : (
                <span className="text-xs text-muted-foreground">--</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
