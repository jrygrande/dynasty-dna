"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useWaitlistCount } from "@/lib/useWaitlistCount";

const WAITLIST_TARGET = 100;

// Surfaced on /start when a user's leagues aren't supported yet. Combines the
// "try the demo" pitch with the waitlist explainer + progress bar so the user
// reads one coherent story: try it now, and we'll onboard your league at the
// next milestone. Sage tint draws the eye on the otherwise-cream page.
export function DemoLeagueCallout() {
  const { current } = useWaitlistCount();
  const percent = Math.min(
    100,
    Math.round((current / WAITLIST_TARGET) * 100)
  );

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/8 p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Try Dynasty DNA right now
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Your leagues aren&apos;t supported yet — but you can browse a real
          seeded league with anonymized names to check it out.
        </p>
      </div>

      <Link
        href="/demo"
        className="group flex items-center gap-3 rounded-lg border border-primary/30 bg-card px-4 py-2.5 shadow-sm"
      >
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary group-hover:bg-primary/25 transition-[transform,background-color] [transition-duration:350ms] [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none"
        >
          <Sparkles className="h-4 w-4 transition-transform [transition-duration:350ms] [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-[1.08] group-hover:-rotate-[4deg] motion-reduce:transition-none motion-reduce:transform-none" />
        </span>
        <span className="flex-1 text-sm font-semibold text-foreground">
          Browse a real, anonymized league
        </span>
        <ArrowRight aria-hidden className="h-4 w-4 text-primary" />
      </Link>

      <div className="border-t border-primary/15 pt-5 space-y-3">
        <p className="text-sm text-muted-foreground">
          Dynasty DNA will scale with demand. Add your league to the waitlist
          and its data will be loaded when we hit the next user milestone.
        </p>
        <div className="space-y-1.5">
          <Progress value={percent} aria-label="Waitlist progress" />
          <p className="text-xs text-muted-foreground font-mono">
            {current} of {WAITLIST_TARGET} leagues
          </p>
        </div>
      </div>
    </section>
  );
}
