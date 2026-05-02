"use client";

import { useDemoMap } from "@/lib/useDemoMap";
import {
  initialsFromName,
  lookupSwap,
  type DemoUserMapping,
} from "@/lib/demoAnonymize";

type Variant = "team-or-display" | "display-only";

interface ManagerNameProps {
  // Either userId or rosterId is required to look up the demo swap. Both are
  // accepted because some surfaces only have one or the other.
  userId?: string | null;
  rosterId?: number | null;
  // The real display name (Sleeper username).
  displayName?: string | null;
  // The real team name; may be null when the manager hasn't set one.
  teamName?: string | null;
  // Which name to render. "team-or-display" mirrors the existing UI pattern of
  // "team name in bold, fall back to display name". Demo mode swaps in the
  // pseudonym, regardless of which real field would have rendered.
  variant?: Variant;
  fallback?: string;
  className?: string;
}

function pickFromSwap(swap: DemoUserMapping, variant: Variant): string {
  return variant === "display-only" ? swap.displayName : swap.teamName;
}

export function ManagerName({
  userId,
  rosterId,
  displayName,
  teamName,
  variant = "team-or-display",
  fallback = "Unknown",
  className,
}: ManagerNameProps) {
  const { active, map } = useDemoMap();

  if (active && map) {
    const swap = lookupSwap(map, userId, rosterId);
    if (swap) {
      return <span className={className}>{pickFromSwap(swap, variant)}</span>;
    }
  }

  const text =
    variant === "display-only"
      ? displayName || fallback
      : teamName || displayName || fallback;
  return <span className={className}>{text}</span>;
}

// Often the existing UI renders "Team Name (Display Name)" with the display
// in muted text. This helper returns the swapped real name in demo mode and
// suppresses the parenthetical when team and display would collide. Renders
// the surrounding parentheses itself so callers don't have to handle the null.
export function ManagerSecondaryName({
  userId,
  rosterId,
  displayName,
  teamName,
  className,
  parens = true,
}: {
  userId?: string | null;
  rosterId?: number | null;
  displayName?: string | null;
  teamName?: string | null;
  className?: string;
  parens?: boolean;
}) {
  const { active, map } = useDemoMap();

  let secondary: string | null = null;
  if (active && map) {
    const swap = lookupSwap(map, userId, rosterId);
    if (!swap) return null; // demo active but no swap — never leak the real name
    if (swap.displayName === swap.teamName) return null;
    secondary = swap.displayName;
  } else if (teamName && displayName && teamName !== displayName) {
    secondary = displayName;
  }

  if (!secondary) return null;
  return (
    <span className={className}>{parens ? `(${secondary})` : secondary}</span>
  );
}

// Sage-tinted initial chip in demo mode; falls back to the real avatar URL or
// muted initials when not in demo. Use everywhere a manager avatar renders so
// no real image leaks.
export function ManagerAvatar({
  userId,
  rosterId,
  displayName,
  avatarUrl,
  size = 32,
  className,
}: {
  userId?: string | null;
  rosterId?: number | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const { active, map } = useDemoMap();

  const dimension = `${size}px`;
  const baseClass =
    "inline-flex items-center justify-center rounded-full overflow-hidden flex-shrink-0";

  if (active && map) {
    const swap = lookupSwap(map, userId, rosterId);
    if (swap) {
      return (
        <span
          aria-hidden
          className={`${baseClass} bg-primary/15 text-primary font-mono text-[11px] font-semibold ${
            className || ""
          }`}
          style={{ width: dimension, height: dimension }}
        >
          {swap.initials}
        </span>
      );
    }
  }

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={displayName || ""}
        width={size}
        height={size}
        className={`${baseClass} ${className || ""}`}
        style={{ width: dimension, height: dimension }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`${baseClass} bg-muted text-muted-foreground font-mono text-[11px] font-semibold ${
        className || ""
      }`}
      style={{ width: dimension, height: dimension }}
    >
      {initialsFromName(displayName || "??")}
    </span>
  );
}
