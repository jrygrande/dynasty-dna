/**
 * One-shot post-migration backfill for FantasyCalc cache rows under the
 * widened cache key (isSuperFlex, ppr, numTeams, numQbs).
 *
 * Migration 0015 backfilled existing fantasy_calc_values rows with
 * (numTeams=12, numQbs=1). Leagues with non-12-team or non-1-QB rosters
 * therefore get ZERO matches from loadFantasyCalcSnapshot until the cron
 * (PR #148) populates the new combos. Run this script immediately after
 * the migration to populate every distinct (isSuperFlex, ppr, numTeams,
 * numQbs) combo present in the leagues table.
 *
 * Idempotent — safe to re-run. Honors per-config staleness unless --force
 * is passed.
 *
 * Usage:
 *   npm run backfill:fantasycalc                # fetch every missing combo
 *   npm run backfill:fantasycalc -- --dry-run   # print combos without fetching
 *   npm run backfill:fantasycalc -- --force     # re-fetch even if fresh
 */

import {
  getDistinctFantasyCalcConfigs,
  syncFantasyCalcValuesForConfig,
} from "../src/services/fantasyCalcSync";

function parseArgs(argv: string[]): { dryRun: boolean; force: boolean } {
  return {
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
  };
}

function formatCombo(c: {
  isSuperFlex: boolean;
  ppr: number;
  numTeams: number;
  numQbs: number;
}): string {
  return `sf=${c.isSuperFlex} ppr=${c.ppr} teams=${c.numTeams} qbs=${c.numQbs}`;
}

async function main(): Promise<void> {
  const { dryRun, force } = parseArgs(process.argv.slice(2));

  console.log(
    `=== FantasyCalc backfill ===${dryRun ? " (dry-run)" : ""}${force ? " (force)" : ""}`,
  );

  const combos = await getDistinctFantasyCalcConfigs();
  console.log(`Found ${combos.length} distinct combo(s):`);
  for (const combo of combos) {
    console.log(`  - ${formatCombo(combo)}`);
  }

  if (dryRun) {
    console.log("\nDry-run: no fetches performed.");
    return;
  }

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const combo of combos) {
    const label = formatCombo(combo);
    try {
      const result = await syncFantasyCalcValuesForConfig(combo, { force });
      if (result) {
        synced += 1;
        console.log(`  [ok] ${label} -> ${result.toISOString()}`);
      } else {
        skipped += 1;
        console.log(`  [skip] ${label} (no data)`);
      }
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [err] ${label}: ${msg}`);
    }
  }

  console.log(
    `\nDone. synced=${synced} skipped=${skipped} failed=${failed} total=${combos.length}`,
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
