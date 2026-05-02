"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  activateDemo,
  DEMO_BANNER_DISMISSED_KEY,
  dismissDemoBanner,
  exitDemo,
  useDemoActive,
} from "@/lib/useDemoMap";

// Reads the ?demo=1 entry-point query param and converts it into session
// state, then strips the param so shared URLs from the address bar stay
// clean. Wrapped in <Suspense> at the layout level — useSearchParams() opts
// the page out of static rendering otherwise.
function DemoQueryParamSyncImpl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!searchParams) return;
    if (searchParams.get("demo") !== "1") return;
    activateDemo();
    const next = new URLSearchParams(searchParams.toString());
    next.delete("demo");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [searchParams, router, pathname]);

  return null;
}

export function DemoQueryParamSync() {
  return (
    <Suspense fallback={null}>
      <DemoQueryParamSyncImpl />
    </Suspense>
  );
}

// Persistent sage outline pill that replaces the right-side CTA when demo is
// active. ✕ exits demo and routes back to /start.
export function DemoChip() {
  const router = useRouter();
  const { active } = useDemoActive();
  if (!active) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary text-primary bg-primary/8 px-3 py-1 text-xs font-mono uppercase tracking-wide">
      Demo mode
      <button
        type="button"
        onClick={() => {
          exitDemo();
          router.push("/start");
        }}
        aria-label="Exit demo"
        className="inline-flex items-center justify-center rounded-full p-0.5 hover:bg-primary/15 transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// First-visit sticky banner. Dismissible per session. Only renders inside the
// demo league family.
export function DemoBanner() {
  const router = useRouter();
  const { active } = useDemoActive();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(
        window.sessionStorage.getItem(DEMO_BANNER_DISMISSED_KEY) === "1"
      );
    } catch {
      setDismissed(false);
    }
  }, [active]);

  if (!active || dismissed) return null;

  return (
    <div className="border-b border-grade-c/25 bg-grade-c/8">
      <div className="container mx-auto px-6 py-2.5 flex items-center justify-between gap-4 text-sm">
        <p className="text-foreground/90">
          You&apos;re browsing a demo league with anonymized names — explore
          freely, then…{" "}
          <Link
            href="/start"
            onClick={() => exitDemo()}
            className="font-medium text-primary hover:underline"
          >
            Find your real league →
          </Link>
        </p>
        <button
          type="button"
          onClick={() => {
            dismissDemoBanner();
            setDismissed(true);
          }}
          aria-label="Dismiss banner"
          className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
