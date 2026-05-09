/**
 * Manually sync the Sleeper player dictionary into our `players` table.
 * Same path as the daily cron — pass `--force` to bypass the 24-hour
 * staleness gate.
 *
 * Usage:
 *   npm run sync:players
 *   npm run sync:players -- --force
 *   npm run sync:players -- --help
 */
import { syncPlayers } from "../src/services/playerSync";

export interface ParsedArgs {
  help: boolean;
  force: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { help: false, force: false };
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--force") out.force = true;
  }
  return out;
}

export const HELP_TEXT = `sync-players — manually sync the Sleeper player dictionary

Usage:
  npm run sync:players                # respect 24h staleness gate
  npm run sync:players -- --force     # ignore staleness, refetch everything
  npm run sync:players -- --help

Calls the same syncPlayers() service the daily cron uses.`;

interface RunDeps {
  syncPlayers: typeof syncPlayers;
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

  const sync = deps.syncPlayers ?? syncPlayers;
  log(`[sync-players] force=${args.force ? "true" : "false"}`);

  try {
    const count = await sync(args.force, {
      trigger: "manual",
      scope: "manual-script",
    });
    if (count === 0) {
      log("[sync-players] skipped (data fresh)");
    } else {
      log(`[sync-players] success synced=${count}`);
    }
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`[sync-players] failed: ${msg}`);
    return 1;
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
