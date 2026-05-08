import { neon } from "@neondatabase/serverless";
import { resolveDatabaseUrl } from "../src/db";

/**
 * Safety guard for `npm run db:dev:reset`.
 *
 * The script issues `DROP SCHEMA public CASCADE`. If `dotenv -e .env.development`
 * silently fails to load (missing file, typo) it falls back to ambient env —
 * which on a dev machine is `.env.local`, which carries the prod
 * `DATABASE_URL` pulled from Vercel. That has bitten this project before
 * (see memory: feedback_db_migrate_hits_prod.md), so we refuse to run unless
 * the resolved host is unmistakably a dev branch.
 *
 * A host is considered "dev" when ANY of:
 *   - its hostname contains "-dev." or "dev-branch"
 *   - it appears in the comma-separated `NEON_DEV_HOST_ALLOWLIST` env var
 *   - the caller passes `--i-know-this-is-prod` (escape hatch for the rare
 *     maintenance case where you really do mean to wipe prod)
 *
 * Exported for unit tests.
 */
export type GuardResult =
  | { ok: true; reason: "dev-host" | "allowlist" | "override" }
  | { ok: false; host: string; source: "DATABASE_URL" | "DATABASE_URL_DEV" };

export function isHostAllowed(args: {
  host: string;
  source: "DATABASE_URL" | "DATABASE_URL_DEV";
  allowlist?: string;
  override?: boolean;
}): GuardResult {
  const { host, source, allowlist, override } = args;

  if (override) {
    return { ok: true, reason: "override" };
  }

  const lower = host.toLowerCase();
  if (lower.includes("-dev.") || lower.includes("dev-branch")) {
    return { ok: true, reason: "dev-host" };
  }

  if (allowlist) {
    const allowed = allowlist
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.includes(lower)) {
      return { ok: true, reason: "allowlist" };
    }
  }

  return { ok: false, host, source };
}

export function parseHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    // neon URLs are well-formed; if parsing fails, return the raw URL so the
    // guard error message still surfaces something useful.
    return url;
  }
}

export type SqlClient = (query: string) => Promise<unknown>;

export async function run(opts: {
  sqlClient?: SqlClient;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
} = {}): Promise<void> {
  const env = opts.env ?? process.env;
  const argv = opts.argv ?? process.argv.slice(2);
  const override = argv.includes("--i-know-this-is-prod");

  const { url, source } = resolveDatabaseUrl(env);
  const host = parseHost(url);
  const guard = isHostAllowed({
    host,
    source,
    allowlist: env.NEON_DEV_HOST_ALLOWLIST,
    override,
  });

  if (!guard.ok) {
    console.error("");
    console.error("REFUSING to reset database: host does not look like a dev branch.");
    console.error(`  resolved host: ${guard.host}`);
    console.error(`  resolved from: ${guard.source}`);
    console.error("");
    console.error("Allowed when ANY of:");
    console.error("  - host contains '-dev.' or 'dev-branch'");
    console.error("  - host is listed in NEON_DEV_HOST_ALLOWLIST (comma-separated)");
    console.error("  - --i-know-this-is-prod is passed (escape hatch)");
    console.error("");
    console.error("If you intended to reset the dev branch, check that .env.development");
    console.error("loaded correctly and points DATABASE_URL at the Neon dev branch.");
    process.exit(1);
  }

  const sql = opts.sqlClient ?? neon(url);
  await sql("DROP SCHEMA public CASCADE");
  await sql("CREATE SCHEMA public");
  console.log(`Schema reset complete (host: ${host}, guard: ${guard.reason})`);
}

// Only auto-run when invoked directly (not when imported by tests).
if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
