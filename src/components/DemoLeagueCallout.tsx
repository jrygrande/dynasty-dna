"use client";

import { Sparkles } from "lucide-react";
import { DemoLinkTile } from "@/components/DemoLinkTile";
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

      <DemoLinkTile
        href="/demo"
        icon={Sparkles}
        label="Browse a real, anonymized league"
      />

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
