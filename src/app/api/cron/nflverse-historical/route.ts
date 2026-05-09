// Monthly cron: re-check historical nflverse seasons (2002 .. currentSeason-1)
// for late corrections.
//
// Vercel Hobby plan caps cron frequency at daily, so we register this as a
// weekly Sunday 09:00 UTC cron and gate inside the handler: we only do real
// work on the first Sunday of each month. Off-month invocations short-circuit
// and return 200 with `{ ranWork: false }` so they show up in logs as
// healthy no-ops.
//
// `force: false` (default) for these helpers means the watermark fast-path
// skips already-populated seasons. The point of this job is to catch the
// rare nflverse correction (~10% of plays revised after the season ends)
// without re-downloading every season every day. To intentionally re-pull
// a historical season, hit `/api/sync/injuries` etc. with `{ force: true }`
// (or wire a one-shot script).

import { NextRequest } from "next/server";
import { syncInjuries } from "@/services/injurySync";
import { syncRosterStatus } from "@/services/rosterStatusSync";
import { syncSchedule } from "@/services/scheduleSync";
import { currentSeason } from "@/services/nflverseWatermark";
import { recordSyncBreadcrumb } from "@/lib/observability/syncBreadcrumb";
import { classifyOutcome, runCron } from "../_lib/runCron";
import { isFirstSundayOfMonth } from "../_lib/cronSchedule";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FIRST_HISTORICAL_SEASON = 2002;

type NflverseSourceLabel = "injuries" | "roster_status" | "schedule";

interface SourceResult {
  source: NflverseSourceLabel;
  ok: boolean;
  total?: number;
  seasonsTouched?: number;
  error?: string;
}

interface SyncSummary {
  total: number;
  seasonResults: Record<number, number>;
}

async function runSource(
  label: NflverseSourceLabel,
  scope: string,
  fn: () => Promise<SyncSummary>
): Promise<SourceResult> {
  try {
    const r = await fn();
    const seasonsTouched = Object.values(r.seasonResults).filter(
      (c) => c > 0
    ).length;
    return { source: label, ok: true, total: r.total, seasonsTouched };
  } catch (err) {
    const message = err instanceof Error ? err.message : `${label} sync failed`;
    recordSyncBreadcrumb({
      source: "nflverse",
      trigger: "cron",
      scope: `${scope}:${label}`,
      outcome: "failed",
      error: message,
    });
    return { source: label, ok: false, error: message };
  }
}

export async function GET(req: NextRequest) {
  const lastHistorical = currentSeason() - 1;
  const scope = `nflverse-historical:${FIRST_HISTORICAL_SEASON}-${lastHistorical}`;

  return runCron(
    req,
    { name: "nflverse-historical", source: "nflverse", scope },
    async () => {
      // Off-month: no work. Auth + breadcrumb + log still happen via runCron.
      if (!isFirstSundayOfMonth()) {
        return {
          callsMade: 0,
          summary: { ranWork: false, reason: "not-first-sunday-of-month" },
        };
      }

      const seasons: number[] = [];
      for (let s = FIRST_HISTORICAL_SEASON; s <= lastHistorical; s++) {
        seasons.push(s);
      }

      // Three sources are independent — run in parallel. The watermark
      // fast-path makes most seasons cheap no-ops, so total wall time is
      // dominated by whichever source has the most "first-sync" work.
      const results = await Promise.all([
        runSource("injuries", scope, () => syncInjuries({ seasons })),
        runSource("roster_status", scope, () => syncRosterStatus({ seasons })),
        runSource("schedule", scope, () => syncSchedule({ seasons })),
      ]);

      const failures = results.filter((r) => !r.ok).length;
      return {
        callsMade: results.length,
        outcome: classifyOutcome(results),
        errorSummary:
          failures > 0
            ? `${failures}/${results.length} sources failed`
            : undefined,
        summary: {
          ranWork: true,
          seasonRange: [FIRST_HISTORICAL_SEASON, lastHistorical],
          results,
        },
      };
    }
  );
}
