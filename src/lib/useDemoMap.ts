"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import { DEMO_SEED_COOKIE } from "@/lib/demoAnonymize";

export const DEMO_BANNER_DISMISSED_KEY = "dd_demo_banner_dismissed";
const DEMO_STATE_EVENT = "dd:demo-state";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) return part.slice(prefix.length) || null;
  }
  return null;
}

function emitStateChange() {
  if (typeof window === "undefined") return;
  queueMicrotask(() => window.dispatchEvent(new Event(DEMO_STATE_EVENT)));
}

export async function exitDemo() {
  // Clear synchronously FIRST so any same-tick navigation (e.g. clicking
  // "Open" on a real league) issues its API requests without the cookie.
  // The fetch below is the canonical server-side wipe; fire-and-forget if
  // the caller doesn't await.
  if (typeof document !== "undefined") {
    document.cookie = `${DEMO_SEED_COOKIE}=; Path=/; Max-Age=0`;
  }
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(DEMO_BANNER_DISMISSED_KEY);
    } catch {
      // ignore
    }
  }
  emitStateChange();
  try {
    await fetch("/api/demo/exit", { method: "POST" });
  } catch {
    // Best-effort; the document.cookie clear above is the load-bearing step.
  }
}

export function dismissDemoBanner() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DEMO_BANNER_DISMISSED_KEY, "1");
  } catch {
    // ignore
  }
  emitStateChange();
}

// useSyncExternalStore compares snapshots with Object.is, and strings
// compare by value — no caching layer needed.
function getDemoSeedSnapshot(): string | null {
  return readCookie(DEMO_SEED_COOKIE);
}

function subscribeToDemoState(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DEMO_STATE_EVENT, callback);
  return () => window.removeEventListener(DEMO_STATE_EVENT, callback);
}

function useDemoSeed(): string | null {
  return useSyncExternalStore(
    subscribeToDemoState,
    getDemoSeedSnapshot,
    () => null
  );
}

function useCurrentFamilyId(): string | null {
  const params = useParams();
  const raw = (params as Record<string, string | string[]>)?.familyId;
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

interface DemoActiveState {
  active: boolean;
  demoFamilyId: string | null;
  loading: boolean;
}

// True when the demo cookie is present AND the current page is the singleton
// demo family. Used by the persistent chip + first-visit banner.
export function useDemoActive(): DemoActiveState {
  const seed = useDemoSeed();
  const familyId = useCurrentFamilyId();
  const [demoFamilyId, setDemoFamilyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/demo/league")
      .then((r) => (r.ok ? r.json() : { family_id: null }))
      .then((d) => {
        if (cancelled) return;
        setDemoFamilyId(d.family_id ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const active =
    !!seed && !!demoFamilyId && familyId === demoFamilyId;
  return { active, demoFamilyId, loading };
}
