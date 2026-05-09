// Sleeper API rolling rate-limit utilization gauge.
//
// Sleeper enforces ~1000 requests/minute. We pace requests at <=15 RPS in
// the client, but actual utilization can dip well below that when callers
// idle. To know whether we're brushing up against the ceiling — and to
// alert before we get throttled — we keep a per-client rolling window of
// request timestamps over the last 60 seconds and emit a gauge to Sentry
// once a minute (or to the console when no DSN is set).
//
// The instrumentation is intentionally side-effect free until the first
// request lands — no background timers, no module-level setInterval. The
// minute-tick decision rides off `Date.now()` checked on every recordCall,
// so unit tests can drive it deterministically without timer mocks.

import * as Sentry from "@sentry/nextjs";

/** Sleeper's documented limit: 1000 calls / minute. */
export const SLEEPER_LIMIT_PER_MINUTE = 1000;
/** Rolling window we sample for the gauge. */
const WINDOW_MS = 60 * 1000;
/** How often we flush the gauge. */
const FLUSH_INTERVAL_MS = 60 * 1000;

const callTimestamps: number[] = [];
let lastFlushAt = 0;
/**
 * Monotonic count of every Sleeper call made since process start. Snapshot
 * with `getTotalSleeperCalls()` before/after a sync to attribute API-call
 * counts to a `sync_jobs` row. Separate from the rolling window (which
 * prunes); never decrements.
 */
let totalCalls = 0;

function isDsnConfigured(): boolean {
  return Boolean(
    process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  );
}

function pruneOldCalls(now: number): void {
  const cutoff = now - WINDOW_MS;
  while (callTimestamps.length > 0 && callTimestamps[0] < cutoff) {
    callTimestamps.shift();
  }
}

/** Returns the count of API calls in the rolling 60s window. */
export function getCurrentCallsPerMinute(now: number = Date.now()): number {
  pruneOldCalls(now);
  return callTimestamps.length;
}

/** Returns utilization as a percentage of the documented Sleeper limit. */
export function getCurrentUtilizationPct(now: number = Date.now()): number {
  const callsInWindow = getCurrentCallsPerMinute(now);
  return Math.min(
    100,
    Math.round((callsInWindow / SLEEPER_LIMIT_PER_MINUTE) * 100),
  );
}

/**
 * Forcibly emit the gauge regardless of when it was last flushed. Used by
 * tests + diagnostic scripts.
 */
export function flushSleeperRateGauge(now: number = Date.now()): void {
  const callsInWindow = getCurrentCallsPerMinute(now);
  const utilizationPct = getCurrentUtilizationPct(now);
  lastFlushAt = now;

  const payload = {
    callsPerMinute: callsInWindow,
    utilizationPct,
    limit: SLEEPER_LIMIT_PER_MINUTE,
  };

  if (!isDsnConfigured()) {
    // eslint-disable-next-line no-console
    console.info("[sleeper.rate]", payload);
    return;
  }

  try {
    type MetricsApi = {
      gauge?: (
        name: string,
        value: number,
        opts?: { unit?: string; tags?: Record<string, string> },
      ) => void;
    };
    // Sentry's metrics API is namespaced under `Sentry.metrics`. It's
    // available in newer SDK versions but we feature-detect rather than
    // assume — falling back to a breadcrumb keeps the signal flowing on
    // older runtimes.
    const sentryWithMetrics = Sentry as typeof Sentry & {
      metrics?: MetricsApi;
    };
    const metrics = sentryWithMetrics.metrics;
    if (metrics && typeof metrics.gauge === "function") {
      metrics.gauge("sleeper.rate_utilization_pct", utilizationPct, {
        unit: "percent",
      });
      metrics.gauge("sleeper.calls_per_minute", callsInWindow, {
        unit: "none",
      });
    } else {
      Sentry.addBreadcrumb({
        category: "sleeper.rate",
        type: "info",
        level: utilizationPct > 80 ? "warning" : "info",
        message: `sleeper.rate ${utilizationPct}%`,
        data: payload,
      });
    }
  } catch {
    // Never let observability break the caller.
  }
}

/**
 * Record a single Sleeper API call. Cheap and synchronous — keeps a small
 * in-memory ring buffer pruned to the last 60 seconds. Once a minute
 * (best-effort, sampled lazily on recordCall) we emit the rate gauge.
 */
export function recordSleeperCall(now: number = Date.now()): void {
  callTimestamps.push(now);
  totalCalls++;
  pruneOldCalls(now);

  if (now - lastFlushAt >= FLUSH_INTERVAL_MS) {
    flushSleeperRateGauge(now);
  }
}

/**
 * Snapshot the lifetime call count. Used by sync entry points to attribute
 * Sleeper API spend to a `sync_jobs` row by diffing before/after.
 */
export function getTotalSleeperCalls(): number {
  return totalCalls;
}

/** Test-only: drop every retained call timestamp. */
export function __resetSleeperRateState(): void {
  callTimestamps.length = 0;
  lastFlushAt = 0;
  totalCalls = 0;
}

/** Test-only: read the lastFlushAt cursor. */
export function __getLastFlushAt(): number {
  return lastFlushAt;
}
