// Sync breadcrumb helper.
//
// Single entry point used by every sync run / cron tick / lazy refresh to
// record a structured breadcrumb. When a Sentry DSN is configured the
// payload is forwarded to `Sentry.addBreadcrumb` (and `Sentry.captureMessage`
// for failed outcomes). When no DSN is set we fall back to `console.info`,
// which keeps local-dev observability legible without requiring Sentry.

import * as Sentry from "@sentry/nextjs";

/** Where the sync was kicked off from. */
export type SyncSource =
  | "sleeper"
  | "fantasycalc"
  | "nflverse"
  | "league-family"
  | "manual";

/** What triggered the sync. */
export type SyncTrigger = "cron" | "lazy" | "manual";

/** Final state of the sync run. */
export type SyncOutcome = "success" | "partial" | "failed";

export interface SyncBreadcrumbPayload {
  source: SyncSource;
  trigger: SyncTrigger;
  /**
   * Free-form scope identifier for the run — typically a `familyId`,
   * `leagueId`, or label such as `"all-leagues"` for global cron jobs.
   */
  scope: string;
  durationMs?: number;
  apiCalls?: number;
  outcome: SyncOutcome;
  /** Error message or description when `outcome === "failed"`. */
  error?: string;
}

function isDsnConfigured(): boolean {
  return Boolean(
    process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  );
}

/**
 * Record a sync breadcrumb. Safe to call from anywhere — falls back to
 * `console.info` when Sentry is not configured. Never throws.
 */
export function recordSyncBreadcrumb(payload: SyncBreadcrumbPayload): void {
  const data = {
    source: payload.source,
    trigger: payload.trigger,
    scope: payload.scope,
    durationMs: payload.durationMs,
    apiCalls: payload.apiCalls,
    outcome: payload.outcome,
    error: payload.error,
  };

  if (!isDsnConfigured()) {
    // Local dev / unconfigured environments: print structured payload so the
    // signal is still legible during development.
    // eslint-disable-next-line no-console
    console.info("[sync]", data);
    return;
  }

  try {
    Sentry.addBreadcrumb({
      category: "sync",
      type: payload.outcome === "failed" ? "error" : "info",
      level:
        payload.outcome === "failed"
          ? "error"
          : payload.outcome === "partial"
            ? "warning"
            : "info",
      message: `sync.${payload.source}.${payload.outcome}`,
      data,
    });

    if (payload.outcome === "failed") {
      Sentry.captureMessage(
        `sync ${payload.source} failed (${payload.scope})`,
        {
          level: "error",
          extra: data,
        },
      );
    }
  } catch {
    // Never let observability break the caller.
  }
}
