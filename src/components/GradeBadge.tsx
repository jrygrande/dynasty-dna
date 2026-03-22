export const GRADE_COLORS: Record<string, string> = {
  "A+": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  A: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  "B+": "bg-blue-500/15 text-blue-400 border-blue-500/25",
  B: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  C: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
  D: "bg-orange-500/15 text-orange-400 border-orange-500/25",
  "D-": "bg-orange-500/10 text-orange-400 border-orange-500/20",
  F: "bg-red-500/15 text-red-400 border-red-500/25",
};

export function GradeBadge({
  grade,
  size = "sm",
}: {
  grade: string;
  size?: "xs" | "sm";
}) {
  const colorClass = GRADE_COLORS[grade] || "bg-muted text-muted-foreground";
  const sizeClass =
    size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center rounded font-bold border ${sizeClass} ${colorClass}`}
      aria-label={`Grade: ${grade}`}
    >
      {grade}
    </span>
  );
}
