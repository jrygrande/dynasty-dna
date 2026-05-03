import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

// Surfaced on /start when a user's leagues aren't supported yet, as the
// primary "try Dynasty DNA right now" path while they wait. Sage tint draws
// the eye without competing with the waitlist's neutral progress bar above.
export function DemoLeagueCallout() {
  return (
    <Link
      href="/demo"
      className="group block rounded-xl border border-primary/30 bg-primary/8 px-5 py-4 transition-colors hover:bg-primary/12"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
        >
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            See Dynasty DNA on a demo league
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            Browse a real league with anonymized names — trade grades, draft
            grades, lineup efficiency, and the Lineage Tracer, on real data.
          </p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium shrink-0 group-hover:bg-primary/90 transition-colors">
          Browse demo
          <ArrowRight className="h-4 w-4" />
        </span>
        <ArrowRight
          aria-hidden
          className="sm:hidden h-5 w-5 text-primary shrink-0 self-center"
        />
      </div>
    </Link>
  );
}
