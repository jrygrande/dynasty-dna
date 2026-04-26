"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

interface CopyLinkButtonProps {
  hasFocus: boolean;
}

/**
 * Copies the current window.location.href to the clipboard and shows a small
 * toast confirmation. Falls back to execCommand when the async Clipboard API
 * is unavailable (e.g. non-secure contexts).
 */
export function CopyLinkButton({ hasFocus }: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    let ok = false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      } else {
        ok = legacyCopy(url);
      }
    } catch {
      ok = legacyCopy(url);
    }
    if (!ok) return;
    setCopied(true);
    trackEvent("graph_link_copied", { hasFocus });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [hasFocus]);

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
        aria-label="Copy link to this graph view"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        <span>{copied ? "Copied" : "Copy link"}</span>
      </button>
      {copied && (
        <div
          role="status"
          className="absolute top-full right-0 mt-1 px-2 py-1 text-xs rounded-md bg-foreground text-background shadow whitespace-nowrap"
        >
          Link copied
        </div>
      )}
    </div>
  );
}

function legacyCopy(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export default CopyLinkButton;
