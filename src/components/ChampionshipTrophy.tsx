import { Trophy } from "lucide-react";

const ICON_CLASS = "h-3.5 w-3.5 text-primary shrink-0";

export function ChampionshipTrophy({ year }: { year: string }) {
  const label = `${year} champion`;
  return (
    <span
      className="inline-flex items-center"
      role="img"
      aria-label={label}
      title={label}
    >
      <Trophy className={ICON_CLASS} />
    </span>
  );
}

export function ChampionshipTrophies({ years }: { years: string[] }) {
  if (years.length === 0) return null;
  const sorted = [...years].sort();
  const summary =
    sorted.length === 1
      ? `${sorted[0]} champion`
      : `${sorted.length}× champion (${sorted.join(", ")})`;
  return (
    <span
      className="inline-flex items-center gap-0.5 align-baseline"
      role="img"
      aria-label={summary}
      title={summary}
    >
      {sorted.map((year) => (
        <Trophy key={year} className={ICON_CLASS} aria-hidden />
      ))}
    </span>
  );
}
