// Shared cron-route runner.
//
// Every /api/cron/* route has the same outer shape:
//   1. Reject unauthenticated callers (401)
//   2. Record an entry breadcrumb so Sentry shows the run starting
//   3. Execute the body inside a Sentry transaction
//   4. Record a success/partial/failure breadcrumb with duration + apiCalls
//   5. Emit one structured JSON log line for Vercel log searchability
//   6. Return { ok, durationMs, callsMade, summary } / 5xx { ok: false, error }
//
// Wrapping it once removes ~60 lines of near-identical boilerplate per route
// and guarantees the breadcrumb/log shape stays in lockstep across all crons.

import { NextRequest, NextResponse } from "next/server";
import {
  recordSyncBreadcrumb,
  type SyncSource,
  type SyncOutcome,
} from "@/lib/observability/syncBreadcrumb";
import { withSyncTransaction } from "@/lib/observability/withSyncTransaction";
import { isAuthorizedCron } from "./auth";

export interface CronResult {
  /** Number of upstream API calls made (Sleeper / FantasyCalc / nflverse). */
  callsMade: number;
  /** Per-route summary; serialized as `summary` in the response body. */
  summary: Record<string, unknown>;
  /**
   * Outcome classification. Defaults to "success" when omitted; routes that
   * iterate over multiple work units should return "partial" / "failed" so
   * the breadcrumb level and HTTP status reflect reality.
   */
  outcome?: SyncOutcome;
  /**
   * Optional failure summary string. Surfaced on the breadcrumb and on the
   * 500 response body when `outcome === "failed"`.
   */
  errorSummary?: string;
}

export interface RunCronOptions {
  /** Cron route name — used in transaction names + log lines. */
  name: string;
  /** Sentry source tag; matches `recordSyncBreadcrumb({ source })`. */
  source: SyncSource;
  /** Free-form scope identifier, e.g. `"sleeper-players"` or `"nflverse-current:2025"`. */
  scope: string;
}

/**
 * Run a cron route handler. Handles auth, observability, and response shape;
 * the caller's `body` only has to do the actual work and return a result.
 */
export async function runCron(
  req: NextRequest | Request,
  opts: RunCronOptions,
  body: () => Promise<CronResult>
): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const start = Date.now();

  // Entry signal: classified as "success" because the SyncOutcome type has
  // no "started" variant. This produces a Sentry breadcrumb at info level
  // marking the run beginning; the final breadcrumb (below) carries the
  // real durationMs/outcome.
  recordSyncBreadcrumb({
    source: opts.source,
    trigger: "cron",
    scope: opts.scope,
    outcome: "success",
    apiCalls: 0,
  });

  try {
    const result = await withSyncTransaction(
      `cron.${opts.name}`,
      "cron.sync",
      body
    );

    const durationMs = Date.now() - start;
    const outcome: SyncOutcome = result.outcome ?? "success";

    recordSyncBreadcrumb({
      source: opts.source,
      trigger: "cron",
      scope: opts.scope,
      outcome,
      durationMs,
      apiCalls: result.callsMade,
      error: result.errorSummary,
    });

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        msg: `cron.${opts.name}.complete`,
        durationMs,
        callsMade: result.callsMade,
        outcome,
        ...result.summary,
      })
    );

    if (outcome === "failed") {
      return NextResponse.json(
        {
          ok: false,
          error: result.errorSummary ?? `${opts.name} cron failed`,
          durationMs,
          callsMade: result.callsMade,
          summary: result.summary,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      durationMs,
      callsMade: result.callsMade,
      summary: result.summary,
    });
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : `${opts.name} cron failed`;

    recordSyncBreadcrumb({
      source: opts.source,
      trigger: "cron",
      scope: opts.scope,
      outcome: "failed",
      durationMs,
      error: message,
    });

    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        msg: `cron.${opts.name}.failed`,
        durationMs,
        error: message,
      })
    );

    return NextResponse.json(
      { ok: false, error: message, durationMs },
      { status: 500 }
    );
  }
}

/**
 * Classify outcome from a list of per-unit results (combos, sources, etc.).
 * - All ok → "success"
 * - All failed → "failed"
 * - Mixed → "partial"
 * Returns "success" for an empty list (nothing to do).
 */
export function classifyOutcome(
  results: Array<{ ok: boolean }>
): SyncOutcome {
  if (results.length === 0) return "success";
  const failures = results.filter((r) => !r.ok).length;
  if (failures === 0) return "success";
  if (failures === results.length) return "failed";
  return "partial";
}
