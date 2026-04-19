"use client";

import type { MouseEvent } from "react";

export function RemoveButton({ onRemove }: { onRemove: () => void }) {
  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    e.preventDefault();
    onRemove();
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseDown={(e) => e.stopPropagation()}
      aria-label="Remove from graph"
      className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full border border-border bg-background text-[10px] leading-none text-muted-foreground shadow-sm group-hover:flex hover:text-destructive hover:border-destructive/50"
    >
      ×
    </button>
  );
}
