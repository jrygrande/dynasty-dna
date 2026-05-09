// Daily cron: refresh nflverse data for the current NFL season.
//
// Schedule: 08:00 UTC daily.
// Sources covered: injuries + weekly roster status + schedule.
// All three are forced (`force: true`) so the new watermark logic
// re-fetches week-over-week mid-season, regardless of whether rows already
// exist for the season.
//
// Failure isolation: each source runs independently (Promise.allSettled).
// One source erroring (404 from nflverse mid-week, transient GH outage)
// does not block the other two from updating.

import { NextRequest } from "next/server";
import { syncInjuries } from "@/services/injurySync";
import { syncRosterStatus } from "@/services/rosterStatusSync";
import { syncSchedule } from "@/services/scheduleSync";
import { currentSeason } from "@/services/nflverseWatermark";
import { recordSyncBreadcrumb } from "@/lib/observability/syncBreadcrumb";
import { classifyOutcome, runCron } from "../_lib/runCron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

/**
 * Run a single nflverse sync source, recording a per-source failure
 * breadcrumb on error so debugging knows which leg blew up.
 */
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
  const season = currentSeason();
  const scope = `nflverse-current:${season}`;

  return runCron(
    req,
    { name: "nflverse-current", source: "nflverse", scope },
    async () => {
      // Three sources are independent — run in parallel.
      const results = await Promise.all([
        runSource("injuries", scope, () =>
          syncInjuries({ seasons: [season], force: true })
        ),
        runSource("roster_status", scope, () =>
          syncRosterStatus({ seasons: [season], force: true })
        ),
        runSource("schedule", scope, () =>
          syncSchedule({ seasons: [season], force: true })
        ),
      ]);

      const failures = results.filter((r) => !r.ok).length;
      return {
        callsMade: results.length, // one HTTP fetch per source
        outcome: classifyOutcome(results),
        errorSummary:
          failures > 0
            ? `${failures}/${results.length} sources failed`
            : undefined,
        summary: { season, results },
      };
    }
  );
}
