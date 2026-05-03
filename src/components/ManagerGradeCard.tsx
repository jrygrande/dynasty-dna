import { GradeBadge } from "@/components/GradeBadge";
import { PILLAR_LABELS } from "@/lib/pillars";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

interface ManagerGradeCardProps {
  mps: {
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
  mps,
  pillarScores,
}: ManagerGradeCardProps) {
  if (!mps) {
    return (
      <div className="border rounded-lg p-6 text-center text-muted-foreground text-sm">
        No MPS yet — sync league data to generate grades
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-6">
      <div className="flex items-center gap-4 mb-6">
        <div className="text-5xl font-bold">{ordinal(Math.round(mps.percentile))}</div>
        <div>
          <GradeBadge grade={mps.grade} size="sm" />
          <div className="text-xs text-muted-foreground mt-1">
            MPS: {mps.value}
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
                  <span className="text-sm font-mono">{ordinal(Math.round(pillar.percentile))}</span>
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
