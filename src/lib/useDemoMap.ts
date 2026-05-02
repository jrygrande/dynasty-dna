"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  buildDemoMap,
  generateSeed,
  type DemoMap,
  type ManagerInput,
  type RosterInput,
} from "@/lib/demoAnonymize";

export const DEMO_ACTIVE_KEY = "dd_demo_active";
export const DEMO_SEED_KEY = "dd_demo_seed";
export const DEMO_BANNER_DISMISSED_KEY = "dd_demo_banner_dismissed";
const DEMO_STATE_EVENT = "dd:demo-state";

interface DemoData {
  family_id: string | null;
  managers: ManagerInput[];
  rosters: RosterInput[];
}

interface DemoState {
  active: boolean;
  // The singleton demo family from the API. null = none configured.
  demoFamilyId: string | null;
  // The mapping for the current page, or null if not in demo mode.
  map: DemoMap | null;
  loading: boolean;
}

let cached: { data: DemoData; ts: number } | null = null;
let inflight: Promise<DemoData> | null = null;

function readSession(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, value);
    }
  } catch {
    // ignore — sessionStorage may be blocked in private modes
  }
}

function emitStateChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(DEMO_STATE_EVENT));
  }
}

async function fetchDemoData(): Promise<DemoData> {
  const now = Date.now();
  if (cached && now - cached.ts < 5 * 60 * 1000) return cached.data;
  if (inflight) return inflight;
  inflight = fetch("/api/demo/data")
    .then((r) => (r.ok ? r.json() : { family_id: null, managers: [], rosters: [] }))
    .then((data: DemoData) => {
      cached = { data, ts: Date.now() };
      inflight = null;
      return data;
    })
    .catch(() => {
      inflight = null;
      return { family_id: null, managers: [], rosters: [] };
    });
  return inflight;
}

// Imperatively activates demo mode for the current session. Used by chip /
// query-param entry points.
export function activateDemo(): string {
  let seed = readSession(DEMO_SEED_KEY);
  if (!seed) {
    seed = generateSeed();
    writeSession(DEMO_SEED_KEY, seed);
  }
  writeSession(DEMO_ACTIVE_KEY, "1");
  emitStateChange();
  return seed;
}

export function exitDemo() {
  writeSession(DEMO_ACTIVE_KEY, null);
  writeSession(DEMO_SEED_KEY, null);
  writeSession(DEMO_BANNER_DISMISSED_KEY, null);
  emitStateChange();
}

export function dismissDemoBanner() {
  writeSession(DEMO_BANNER_DISMISSED_KEY, "1");
  emitStateChange();
}

// Resolve the current familyId from the route params. Demo only applies to
// /league/[familyId]/* surfaces; on any other route the familyId is null and
// the hook treats demo as inactive.
function useCurrentFamilyId(): string | null {
  const params = useParams();
  const raw = (params as Record<string, string | string[]>)?.familyId;
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

// Tracks the (active flag, seed) tuple from sessionStorage and re-renders when
// it changes. State is the storage value itself — no proxy `tick` needed.
function useDemoSession(): { flag: string | null; seed: string | null } {
  const [snapshot, setSnapshot] = useState<{
    flag: string | null;
    seed: string | null;
  }>(() => ({
    flag: readSession(DEMO_ACTIVE_KEY),
    seed: readSession(DEMO_SEED_KEY),
  }));

  useEffect(() => {
    function refresh() {
      setSnapshot((prev) => {
        const next = {
          flag: readSession(DEMO_ACTIVE_KEY),
          seed: readSession(DEMO_SEED_KEY),
        };
        if (prev.flag === next.flag && prev.seed === next.seed) return prev;
        return next;
      });
    }
    refresh();
    window.addEventListener(DEMO_STATE_EVENT, refresh);
    return () => window.removeEventListener(DEMO_STATE_EVENT, refresh);
  }, []);

  return snapshot;
}

export function useDemoMap(): DemoState {
  const familyId = useCurrentFamilyId();

  const [data, setData] = useState<DemoData | null>(null);
  const { flag, seed } = useDemoSession();

  useEffect(() => {
    let cancelled = false;
    fetchDemoData().then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const demoFamilyId = data?.family_id ?? null;
  // Cross-family safety: demo is only active when both flag set AND we're on
  // the configured singleton family. A stale flag on another family is a no-op.
  const active =
    flag === "1" && !!seed && !!demoFamilyId && familyId === demoFamilyId;

  const map = useMemo(() => {
    if (!active || !data || !seed) return null;
    return buildDemoMap(data.managers, data.rosters, seed);
  }, [active, data, seed]);

  return {
    active,
    demoFamilyId,
    map,
    loading: data === null,
  };
}

// Lightweight selector for components that only need to know whether demo is
// active for the current page — the chip + banner. Returns the same active
// flag and family id as useDemoMap without recomputing the mapping.
export function useDemoActive(): {
  active: boolean;
  demoFamilyId: string | null;
  loading: boolean;
} {
  const { active, demoFamilyId, loading } = useDemoMap();
  return { active, demoFamilyId, loading };
}

export function isDemoBannerDismissed(): boolean {
  return readSession(DEMO_BANNER_DISMISSED_KEY) === "1";
}
