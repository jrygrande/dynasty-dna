const GRADE_TOKEN: Record<string, "a" | "b" | "c" | "d" | "f"> = {
  "A+": "a",
  A: "a",
  "A-": "a",
  "B+": "b",
  B: "b",
  "B-": "b",
  "C+": "c",
  C: "c",
  "C-": "c",
  "D+": "d",
  D: "d",
  "D-": "d",
  F: "f",
};

const TOKEN_CLASSES: Record<"a" | "b" | "c" | "d" | "f", string> = {
  a: "text-grade-a bg-grade-a/10 border-grade-a/25",
  b: "text-grade-b bg-grade-b/8 border-grade-b/20",
  c: "text-grade-c bg-grade-c/12 border-grade-c/28",
  d: "text-grade-d bg-grade-d/12 border-grade-d/28",
  f: "text-grade-f bg-grade-f/12 border-grade-f/28",
};

export function gradeColorClass(grade: string): string {
  const token = GRADE_TOKEN[grade];
  return token ? TOKEN_CLASSES[token] : "bg-muted text-muted-foreground border-border";
}

export function GradeBadge({
  grade,
  size = "sm",
}: {
  grade: string;
  size?: "xs" | "sm";
}) {
  const sizeClass =
    size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center rounded font-bold border ${sizeClass} ${gradeColorClass(grade)}`}
      aria-label={`Grade: ${grade}`}
    >
      {grade}
    </span>
  );
}
