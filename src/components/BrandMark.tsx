export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    >
      <path d="M16 10 C 48 22, 16 42, 48 54" />
      <path d="M48 10 C 16 22, 48 42, 16 54" />
      <path d="M22 16 L 42 16" opacity="0.55" />
      <path d="M18 26 L 46 26" opacity="0.55" />
      <path d="M18 38 L 46 38" opacity="0.55" />
      <path d="M22 48 L 42 48" opacity="0.55" />
    </svg>
  );
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <BrandMark className="h-6 w-6 text-primary" />
      <span className="font-serif text-lg font-medium tracking-tight text-foreground">
        Dynasty <span className="text-primary">DNA</span>
      </span>
    </span>
  );
}
