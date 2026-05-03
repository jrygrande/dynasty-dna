import { initialsFromName } from "@/lib/demoAnonymize";

type Variant = "team-or-display" | "display-only";

interface ManagerNameProps {
  // Kept for callers that already pass them; the server has already swapped
  // the displayName/teamName in demo mode, so the rendering itself is now
  // identical for real and demo data.
  userId?: string | null;
  rosterId?: number | null;
  displayName?: string | null;
  teamName?: string | null;
  variant?: Variant;
  fallback?: string;
  className?: string;
}

export function ManagerName({
  displayName,
  teamName,
  variant = "team-or-display",
  fallback = "Unknown",
  className,
}: ManagerNameProps) {
  const text =
    variant === "display-only"
      ? displayName || fallback
      : teamName || displayName || fallback;
  return <span className={className}>{text}</span>;
}

// Renders the secondary "real-display-name" line that historically showed
// next to a team name. In demo mode the server returns the same coach name
// for both fields, so this collapses to null.
export function ManagerSecondaryName({
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
  if (!teamName || !displayName || teamName === displayName) return null;
  return (
    <span className={className}>{parens ? `(${displayName})` : displayName}</span>
  );
}

// Avatar with initial-chip fallback. The server returns null avatar in demo
// mode so this renders the chip with the swapped displayName's initials.
export function ManagerAvatar({
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
  const dimension = `${size}px`;
  const baseClass =
    "inline-flex items-center justify-center rounded-full overflow-hidden flex-shrink-0";

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
