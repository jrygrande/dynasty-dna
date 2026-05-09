/**
 * Manually sync a single league family. Calls the same internal service
 * (`syncLeagueFamily`) that cron + the lazy warm path use, so the result
 * is identical to a triggered sync.
 *
 * Defaults to the dev DB when `DATABASE_URL_DEV` is set in `.env.local`
 * (see `resolveDatabaseUrl` in src/db). Use `--force` to clear the
 * recently-synced-season skip so completed seasons re-sync end-to-end.
 *
 * Usage:
 *   npm run sync:family -- <leagueIdOrFamilyId>
 *   npm run sync:family -- <leagueIdOrFamilyId> --force
 *   npm run sync:family -- --help
 *
 * Notes:
 *   - The first arg can be either a league ID (any season in the family)
 *     or a family ID — the script resolves both via `ensureLeagueFamily`
 *     when the arg is a league ID, else looks the family up directly.
 *   - `--force` deletes the family's `lastSyncedAt` markers so
 *     `syncLeagueFamily` re-syncs every season instead of skipping the
 *     7-day fresh window.
 */
import { syncLeagueFamily } from "../src/services/sync";
import { ensureLeagueFamily } from "../src/services/leagueFamily";
import { getDb, schema } from "../src/db";
import { eq, inArray } from "drizzle-orm";

export interface ParsedArgs {
  help: boolean;
  force: boolean;
  id: string | null;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { help: false, force: false, id: null };
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--force") out.force = true;
    else if (!a.startsWith("--") && out.id === null) out.id = a;
  }
  return out;
}

export const HELP_TEXT = `sync-family — manually sync a league family

Usage:
  npm run sync:family -- <leagueIdOrFamilyId>
  npm run sync:family -- <leagueIdOrFamilyId> --force
  npm run sync:family -- --help

Options:
  --force   Re-sync completed seasons even if they were synced recently
  --help    Print this message

The script picks up DATABASE_URL/DATABASE_URL_DEV from .env.local. To run
against the dev Neon branch, set DATABASE_URL_DEV in .env.local; to hit
prod, leave it unset (and double-check before passing --force).`;

interface RunDeps {
  syncLeagueFamily: typeof syncLeagueFamily;
  // resolveFamilyAndLeagues is the seam tests inject. The default
  // implementation calls ensureLeagueFamily + getDb internally; it isn't
  // exposed separately because callers should never have to choose.
  resolveFamilyAndLeagues: (
    id: string,
    force: boolean
  ) => Promise<{ familyId: string; leagueIds: string[] }>;
  log: (msg: string) => void;
  err: (msg: string) => void;
}

/**
 * Default resolver: accepts either a league ID (resolved through
 * ensureLeagueFamily, which discovers seasons via Sleeper if needed) or a
 * raw family ID. When `force` is true, also clears `lastSyncedAt` on every
 * member league so the staleness skip in syncLeagueFamily can't short-circuit.
 */
async function defaultResolveFamilyAndLeagues(
  id: string,
  force: boolean
): Promise<{ familyId: string; leagueIds: string[] }> {
  const db = getDb();

  // Try as a family ID first (cheap lookup, no Sleeper fetch).
  const familyRow = await db
    .select()
    .from(schema.leagueFamilies)
    .where(eq(schema.leagueFamilies.id, id))
    .limit(1);

  let familyId: string;
  if (familyRow.length > 0) {
    familyId = familyRow[0].id;
  } else {
    // Fall back to treating the arg as a league ID. ensureLeagueFamily
    // discovers all seasons via Sleeper and creates the family if missing.
    familyId = await ensureLeagueFamily(id);
  }

  const members = await db
    .select()
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, familyId));

  const leagueIds = members
    .sort((a, b) => Number(a.season) - Number(b.season))
    .map((m) => m.leagueId);

  if (force && leagueIds.length > 0) {
    // Reset lastSyncedAt so the 7-day completed-season skip in
    // runSyncLeagueFamily can't short-circuit. We don't touch row data.
    await db
      .update(schema.leagues)
      .set({ lastSyncedAt: null })
      .where(inArray(schema.leagues.id, leagueIds));
  }

  return { familyId, leagueIds };
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

  if (!args.id) {
    err("error: missing leagueId or familyId argument");
    err(HELP_TEXT);
    return 1;
  }

  const resolveFamilyAndLeagues =
    deps.resolveFamilyAndLeagues ?? defaultResolveFamilyAndLeagues;
  const sync = deps.syncLeagueFamily ?? syncLeagueFamily;

  log(
    `[sync-family] target=${args.id} force=${args.force ? "true" : "false"}`
  );

  try {
    const { familyId, leagueIds } = await resolveFamilyAndLeagues(
      args.id,
      args.force
    );

    if (leagueIds.length === 0) {
      err(
        `[sync-family] no member leagues found for family ${familyId}; aborting`
      );
      return 1;
    }

    log(
      `[sync-family] family=${familyId} seasons=${leagueIds.length}`
    );

    await sync(leagueIds, undefined, familyId, { trigger: "manual" });

    log(`[sync-family] success`);
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`[sync-family] failed: ${msg}`);
    return 1;
  }
}

// Only execute when invoked directly (not when imported by tests).
if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
