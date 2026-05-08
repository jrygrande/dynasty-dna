import { neon } from "@neondatabase/serverless";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

/**
 * Resolve the database URL for the current environment.
 *
 * Selection rules (first match wins):
 *   1. On Vercel (any `VERCEL_ENV`) -> `DATABASE_URL`. Production paths are
 *      never redirected. This keeps prod and preview deployments stable.
 *   2. Off-Vercel (local scripts, `next dev`, jest) -> `DATABASE_URL_DEV` if
 *      set; otherwise fall back to `DATABASE_URL`.
 *
 * Why a separate `DATABASE_URL_DEV`:
 *   `.env.local` carries the prod URL (it's pulled from Vercel) so naive
 *   local commands like `npm run db:migrate` would mutate prod. Setting
 *   `DATABASE_URL_DEV` in `.env.development` to point at a Neon `dev` branch
 *   gives local work an isolated copy-on-write database without touching the
 *   prod-facing variable.
 *
 * Exported for unit tests.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  source: "DATABASE_URL" | "DATABASE_URL_DEV";
} {
  const onVercel = Boolean(env.VERCEL_ENV);
  const prodUrl = env.DATABASE_URL;
  const devUrl = env.DATABASE_URL_DEV;

  if (onVercel) {
    if (!prodUrl) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    return { url: prodUrl, source: "DATABASE_URL" };
  }

  if (devUrl) {
    return { url: devUrl, source: "DATABASE_URL_DEV" };
  }
  if (prodUrl) {
    return { url: prodUrl, source: "DATABASE_URL" };
  }
  throw new Error(
    "DATABASE_URL environment variable is not set (and no DATABASE_URL_DEV fallback configured)"
  );
}

function getDbUrl(): string {
  return resolveDatabaseUrl().url;
}

// Use globalThis to persist across Next.js hot reloads in dev
const globalForDb = globalThis as unknown as {
  dbInstance: ReturnType<typeof drizzle> | undefined;
  syncDbInstance: ReturnType<typeof drizzleWs> | undefined;
};

export function getDb() {
  if (!globalForDb.dbInstance) {
    // `cache: "no-store"` opts every neon-http request out of Next.js's
    // Data Cache. Without this, fetch() responses from neon's HTTP
    // endpoint get cached indefinitely on Production deployments
    // (preview deployments don't enable the Data Cache, which is why
    // they showed fresh DB rows while production served stale ones —
    // see #41 / Vercel debugging session, May 2026).
    const sql = neon(getDbUrl(), { fetchOptions: { cache: "no-store" } });
    globalForDb.dbInstance = drizzle(sql, { schema });
  }
  return globalForDb.dbInstance;
}

/**
 * Get a WebSocket-based Drizzle instance that supports db.transaction().
 * Use this for sync operations that need atomic delete+reinsert.
 */
export function getSyncDb() {
  if (!globalForDb.syncDbInstance) {
    const pool = new Pool({ connectionString: getDbUrl() });
    globalForDb.syncDbInstance = drizzleWs(pool, { schema });
  }
  return globalForDb.syncDbInstance;
}

export type Db = ReturnType<typeof getDb>;
export type SyncDb = ReturnType<typeof getSyncDb>;
export { schema };
