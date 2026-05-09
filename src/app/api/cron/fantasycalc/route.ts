// Daily cron: refresh FantasyCalc dynasty trade values for every active
// (isSuperFlex, ppr, numTeams, numQbs) combo across `leagues`.
//
// Schedule: 07:00 UTC daily.
// Why per-combo (not per-league)? FantasyCalc returns the same values for
// every league sharing a config, so one fetch per combo serves all of them.
// `getDistinctFantasyCalcConfigs` extracts the unique set from the DB.
//
// Failure isolation: a single combo failing (network blip, rate limit,
// FantasyCalc edge bug) must not abort the whole tick. We catch per combo,
// continue sequentially (FantasyCalc is rate-limited — don't parallelize),
// and surface the partial outcome at the end.

import { NextRequest } from "next/server";
import {
  getDistinctFantasyCalcConfigs,
  syncFantasyCalcValuesForConfig,
  type FantasyCalcConfig,
} from "@/services/fantasyCalcSync";
import { recordSyncBreadcrumb } from "@/lib/observability/syncBreadcrumb";
import { classifyOutcome, runCron } from "../_lib/runCron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ComboResult {
  config: FantasyCalcConfig;
  ok: boolean;
  fetchedAt?: string | null;
  error?: string;
}

export async function GET(req: NextRequest) {
  return runCron(
    req,
    {
      name: "fantasycalc",
      source: "fantasycalc",
      scope: "fantasycalc-all-combos",
    },
    async () => {
      const combos = await getDistinctFantasyCalcConfigs();
      const results: ComboResult[] = [];

      for (const combo of combos) {
        try {
          const fetchedAt = await syncFantasyCalcValuesForConfig(combo, {
            force: true,
          });
          results.push({
            config: combo,
            ok: true,
            fetchedAt: fetchedAt?.toISOString() ?? null,
          });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "combo sync failed";
          results.push({ config: combo, ok: false, error: message });

          recordSyncBreadcrumb({
            source: "fantasycalc",
            trigger: "cron",
            scope: `combo:sf=${combo.isSuperFlex},ppr=${combo.ppr},teams=${combo.numTeams},qbs=${combo.numQbs}`,
            outcome: "failed",
            error: message,
          });
        }
      }

      const outcome = classifyOutcome(results);
      const failures = results.filter((r) => !r.ok).length;

      return {
        callsMade: combos.length,
        outcome,
        errorSummary:
          failures > 0
            ? `${failures}/${results.length} combos failed`
            : undefined,
        summary: {
          combos: results.length,
          failures,
          results,
        },
      };
    }
  );
}
