import { neon } from "@neondatabase/serverless";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

function getDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return url;
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
