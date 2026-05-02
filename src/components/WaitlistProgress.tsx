import { Progress } from "@/components/ui/progress";

interface WaitlistProgressProps {
  current: number;
  target: number;
}

export function WaitlistProgress({ current, target }: WaitlistProgressProps) {
  const goalReached = current >= target;
  const copy = goalReached
    ? "Goal reached — bringing leagues online."
    : "Every milestone brings more leagues online. Add yours to push toward the next.";
  const percent = Math.min(100, Math.round((current / target) * 100));

  return (
    <div className="max-w-md mx-auto mt-8 space-y-2">
      <p className="text-sm text-muted-foreground text-center">{copy}</p>
      <Progress value={percent} aria-label="Waitlist progress" />
      <p className="text-xs text-muted-foreground text-center font-mono">
        {current} of {target} leagues
      </p>
    </div>
  );
}
