import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
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
};

export function getDb() {
  if (!globalForDb.dbInstance) {
    const sql = neon(getDbUrl());
    globalForDb.dbInstance = drizzle(sql, { schema });
  }
  return globalForDb.dbInstance;
}

export type Db = ReturnType<typeof getDb>;
export { schema };
