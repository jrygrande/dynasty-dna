/**
 * Force-refresh the three nflverse data sources (roster status, injuries,
 * schedule) for a single historical season. Useful when nflverse has
 * republished a corrected CSV and you need to re-ingest end-to-end.
 *
 * Usage:
 *   npm run sync:season -- <year>
 *   npm run sync:season -- --help
 *
 * The current season is always force-refreshed by the cron route every run,
 * so passing the current year just duplicates that work — pass a historical
 * season here.
 */
import { syncRosterStatus } from "../src/services/rosterStatusSync";
import { syncInjuries } from "../src/services/injurySync";
import { syncSchedule } from "../src/services/scheduleSync";
import { currentSeason } from "../src/services/nflverseWatermark";

export interface ParsedArgs {
  help: boolean;
  season: number | null;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { help: false, season: null };
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (!a.startsWith("--") && out.season === null) {
      const n = parseInt(a, 10);
      if (!Number.isNaN(n)) out.season = n;
    }
  }
  return out;
}

export const HELP_TEXT = `sync-season — force-refresh nflverse data for one season

Usage:
  npm run sync:season -- <year>
  npm run sync:season -- --help

Refreshes roster status, injuries, and schedule for the given year. Each
service is called with force=true so the historical-season skip is
bypassed. Use this after nflverse republishes a corrected CSV.`;

interface RunDeps {
  syncRosterStatus: typeof syncRosterStatus;
  syncInjuries: typeof syncInjuries;
  syncSchedule: typeof syncSchedule;
  log: (msg: string) => void;
  err: (msg: string) => void;
  currentSeason?: () => number;
}

export async function run(
  argv: string[],
  deps: Partial<RunDeps> = {}
): Promise<number> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const err = deps.err ?? ((m: string) => console.error(m));
  const args = parseArgs(argv);

  if (args.help) {
    log(HELP_TEXT);
    return 0;
  }

  if (args.season === null) {
    err("error: missing or invalid <year> argument");
    err(HELP_TEXT);
    return 1;
  }

  const season = args.season;
  const cur = (deps.currentSeason ?? currentSeason)();
  if (season > cur) {
    err(
      `error: season ${season} is in the future (current=${cur}); aborting`
    );
    return 1;
  }

  const rs = deps.syncRosterStatus ?? syncRosterStatus;
  const inj = deps.syncInjuries ?? syncInjuries;
  const sch = deps.syncSchedule ?? syncSchedule;

  log(`[sync-season] season=${season} force=true`);

  try {
    const rosterRes = await rs({
      seasons: [season],
      force: true,
      trigger: "manual",
    });
    log(`[sync-season] roster_status total=${rosterRes.total}`);

    const injuryRes = await inj({
      seasons: [season],
      force: true,
      trigger: "manual",
    });
    log(`[sync-season] injuries total=${injuryRes.total}`);

    const schedRes = await sch({
      seasons: [season],
      force: true,
      trigger: "manual",
    });
    log(`[sync-season] schedule total=${schedRes.total}`);

    log(`[sync-season] success season=${season}`);
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`[sync-season] failed season=${season}: ${msg}`);
    return 1;
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
