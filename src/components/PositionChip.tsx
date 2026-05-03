const POSITION_COLORS: Record<string, string> = {
  QB: "bg-grade-f/12 text-grade-f",
  RB: "bg-grade-b/12 text-grade-b",
  WR: "bg-grade-a/12 text-grade-a",
  TE: "bg-grade-d/12 text-grade-d",
  K: "bg-chart-4/15 text-chart-4",
  DEF: "bg-muted text-muted-foreground",
};

export function PositionChip({
  position,
  size = "sm",
}: {
  position: string | null | undefined;
  size?: "xs" | "sm";
}) {
  if (!position) return null;
  const palette = POSITION_COLORS[position] ?? "bg-muted text-muted-foreground";
  const sizing =
    size === "xs"
      ? "px-1.5 py-0 text-[10px]"
      : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center ${sizing} font-mono font-medium uppercase tracking-wide rounded-full ${palette}`}
    >
      {position}
    </span>
  );
}
