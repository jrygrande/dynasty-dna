import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

interface DemoLinkTileProps {
  href: string;
  icon: LucideIcon;
  label: string;
  // "default" — white card surface, primary CTA weight.
  // "compact" — cream background, smaller, used as a secondary affordance
  // beneath inputs where the tile shouldn't compete with the primary action.
  variant?: "default" | "compact";
}

export function DemoLinkTile({
  href,
  icon: Icon,
  label,
  variant = "default",
}: DemoLinkTileProps) {
  const isCompact = variant === "compact";

  return (
    <Link
      href={href}
      className={
        isCompact
          ? "group flex items-center gap-2.5 rounded-lg border border-primary/25 bg-background px-3 py-2"
          : "group flex items-center gap-3 rounded-lg border border-primary/30 bg-card px-4 py-2.5 shadow-sm"
      }
    >
      <span
        aria-hidden
        className={`flex shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary group-hover:bg-primary/25 transition-[transform,background-color] [transition-duration:350ms] [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none ${
          isCompact ? "h-7 w-7" : "h-8 w-8"
        }`}
      >
        <Icon
          className={`transition-transform [transition-duration:350ms] [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-[1.08] group-hover:-rotate-[4deg] motion-reduce:transition-none motion-reduce:transform-none ${
            isCompact ? "h-3.5 w-3.5" : "h-4 w-4"
          }`}
        />
      </span>
      <span
        className={`flex-1 font-semibold text-foreground ${
          isCompact ? "text-xs" : "text-sm"
        }`}
      >
        {label}
      </span>
      <ArrowRight
        aria-hidden
        className={`text-primary ${isCompact ? "h-3.5 w-3.5" : "h-4 w-4"}`}
      />
    </Link>
  );
}
