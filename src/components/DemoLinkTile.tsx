import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

interface DemoLinkTileProps {
  href: string;
  icon: LucideIcon;
  label: string;
}

// Sage-bordered tile with an icon that gently animates on hover. Used inside
// the demo callout and beneath the Sleeper username input. Card itself stays
// still — only the icon container darkens + the glyph scales/tilts on hover.
export function DemoLinkTile({ href, icon: Icon, label }: DemoLinkTileProps) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg border border-primary/30 bg-card px-4 py-2.5 shadow-sm"
    >
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary group-hover:bg-primary/25 transition-[transform,background-color] [transition-duration:350ms] [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none"
      >
        <Icon className="h-4 w-4 transition-transform [transition-duration:350ms] [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-[1.08] group-hover:-rotate-[4deg] motion-reduce:transition-none motion-reduce:transform-none" />
      </span>
      <span className="flex-1 text-sm font-semibold text-foreground">
        {label}
      </span>
      <ArrowRight aria-hidden className="h-4 w-4 text-primary" />
    </Link>
  );
}
