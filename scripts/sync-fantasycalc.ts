/**
 * Manually refresh FantasyCalc dynasty values for every distinct
 * (isSuperFlex, ppr, numTeams, numQbs) combo present in our leagues.
 *
 * Same code path as `backfill:fantasycalc` — kept under the `sync:*`
 * namespace to match the manual-sync ergonomic in CLAUDE.md.
 *
 * Usage:
 *   npm run sync:fantasycalc
 *   npm run sync:fantasycalc -- --force
 *   npm run sync:fantasycalc -- --dry-run
 *   npm run sync:fantasycalc -- --help
 */
import {
  getDistinctFantasyCalcConfigs,
  syncFantasyCalcValuesForConfig,
} from "../src/services/fantasyCalcSync";

export interface ParsedArgs {
  help: boolean;
  force: boolean;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { help: false, force: false, dryRun: false };
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--force") out.force = true;
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

export const HELP_TEXT = `sync-fantasycalc — refresh FantasyCalc values for every league combo

Usage:
  npm run sync:fantasycalc                # fetch every combo (respect freshness)
  npm run sync:fantasycalc -- --force     # re-fetch even if fresh
  npm run sync:fantasycalc -- --dry-run   # list combos without fetching
  npm run sync:fantasycalc -- --help`;

function formatCombo(c: {
  isSuperFlex: boolean;
  ppr: number;
  numTeams: number;
  numQbs: number;
}): string {
  return `sf=${c.isSuperFlex} ppr=${c.ppr} teams=${c.numTeams} qbs=${c.numQbs}`;
}

interface RunDeps {
  getDistinctFantasyCalcConfigs: typeof getDistinctFantasyCalcConfigs;
  syncFantasyCalcValuesForConfig: typeof syncFantasyCalcValuesForConfig;
  log: (msg: string) => void;
  err: (msg: string) => void;
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

  const list = deps.getDistinctFantasyCalcConfigs ?? getDistinctFantasyCalcConfigs;
  const sync = deps.syncFantasyCalcValuesForConfig ?? syncFantasyCalcValuesForConfig;

  log(
    `[sync-fantasycalc] force=${args.force ? "true" : "false"} dryRun=${args.dryRun ? "true" : "false"}`
  );

  let combos: Awaited<ReturnType<typeof getDistinctFantasyCalcConfigs>>;
  try {
    combos = await list();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`[sync-fantasycalc] failed to enumerate combos: ${msg}`);
    return 1;
  }

  log(`[sync-fantasycalc] combos=${combos.length}`);
  for (const c of combos) log(`  - ${formatCombo(c)}`);

  if (args.dryRun) {
    log(`[sync-fantasycalc] dry-run: no fetches performed`);
    return 0;
  }

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const combo of combos) {
    const label = formatCombo(combo);
    try {
      const result = await sync(combo, { force: args.force });
      if (result) {
        synced += 1;
        log(`  [ok] ${label} -> ${result.toISOString()}`);
      } else {
        skipped += 1;
        log(`  [skip] ${label} (no data)`);
      }
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      err(`  [err] ${label}: ${msg}`);
    }
  }

  log(
    `[sync-fantasycalc] done synced=${synced} skipped=${skipped} failed=${failed} total=${combos.length}`
  );

  return failed > 0 ? 1 : 0;
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
