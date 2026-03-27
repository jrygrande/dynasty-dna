import { GradeBadge } from "@/components/GradeBadge";
import { PILLAR_LABELS } from "@/lib/pillars";

interface ManagerGradeCardProps {
  overallScore: {
    value: number;
    grade: string;
    percentile: number;
  } | null;
  pillarScores: Record<
    string,
    { value: number; grade: string; percentile: number } | null
  >;
}

export function ManagerGradeCard({
  overallScore,
  pillarScores,
}: ManagerGradeCardProps) {
  if (!overallScore) {
    return (
      <div className="border rounded-lg p-6 text-center text-muted-foreground text-sm">
        No overall score yet — sync league data to generate grades
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-6">
      <div className="flex items-center gap-4 mb-6">
        <div className="text-5xl font-bold">{overallScore.value}</div>
        <div>
          <GradeBadge grade={overallScore.grade} size="sm" />
          <div className="text-xs text-muted-foreground mt-1">
            Top {Math.round(100 - overallScore.percentile)}%
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {Object.entries(PILLAR_LABELS).map(([key, label]) => {
          const pillar = pillarScores[key];
          return (
            <div
              key={key}
              className="flex items-center justify-between border rounded px-3 py-2"
            >
              <span className="text-sm text-muted-foreground">{label}</span>
              {pillar ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono">{pillar.value}</span>
                  <GradeBadge grade={pillar.grade} size="xs" />
                </div>
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
