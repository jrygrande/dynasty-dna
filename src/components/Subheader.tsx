"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { useScrolled } from "@/lib/useScrolled";

interface SubheaderProps {
  title: ReactNode;
  rightSlot?: ReactNode;
}

export function Subheader({ title, rightSlot }: SubheaderProps) {
  const scrolled = useScrolled();
  const ref = useRef<HTMLDivElement>(null);

  // Publish --subheader-height so pages with a fixed-viewport canvas
  // (e.g. /league/[familyId]/graph) can size themselves under the sticky stack.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let last = -1;
    const setVar = () => {
      const h = node.getBoundingClientRect().height;
      if (h === last) return;
      last = h;
      document.body.style.setProperty("--subheader-height", `${h}px`);
    };
    setVar();
    const observer = new ResizeObserver(setVar);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.body.style.removeProperty("--subheader-height");
    };
  }, []);

  return (
    <div
      ref={ref}
      data-subheader
      className={`sticky z-30 bg-background transition-shadow ${
        scrolled ? "shadow-sm" : ""
      }`}
      style={{ top: "var(--subheader-top, var(--nav-height, 0px))" }}
    >
      <div
        className={`container mx-auto px-4 sm:px-6 py-3 ${
          rightSlot
            ? "flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
            : "flex items-center gap-3 sm:gap-4"
        }`}
      >
        <div className="min-w-0 flex-1">
          {typeof title === "string" ? (
            <h1 className="text-base sm:text-lg md:text-xl font-semibold line-clamp-1">
              {title}
            </h1>
          ) : (
            title
          )}
        </div>
        {rightSlot && (
          <div className="flex flex-wrap items-center gap-2">{rightSlot}</div>
        )}
      </div>
    </div>
  );
}
