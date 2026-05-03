"use client";

import { type ReactNode, useState } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface InfoTooltipProps {
  content: ReactNode;
  label?: string;
  className?: string;
  iconClassName?: string;
}

// Desktop: hover/focus opens after a short delay.
// Mobile: tap toggles the open state (Radix Tooltip alone is hover-only,
// which leaves touch users with no way to read the tooltip).
export function InfoTooltip({
  content,
  label,
  className,
  iconClassName = "h-3 w-3",
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          type="button"
          aria-label={label}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className={`inline-flex items-center cursor-help ${className ?? ""}`}
        >
          <Info className={iconClassName} aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
