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
          seeded league with anonymized names while you wait.
        </p>
      </div>

      <Link
        href="/demo"
        className="group relative block overflow-hidden rounded-lg border border-primary/40 bg-card px-5 py-4 shadow-sm transition-all hover:border-primary hover:shadow-md"
      >
        {/* Sheen overlay — slow translate sweep across the tile. Pointer
            events disabled so it never blocks the link click. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-primary/15 to-transparent motion-safe:animate-demo-sheen motion-reduce:hidden"
        />
        <span className="relative flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary"
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="flex-1 text-sm font-semibold text-foreground">
            Browse a real, anonymized league
          </span>
          <ArrowRight
            aria-hidden
            className="h-4 w-4 text-primary transition-transform group-hover:translate-x-0.5"
          />
        </span>
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
