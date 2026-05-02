import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

// Cache headers used by the public /api/demo/* routes. Demo singleton flips
// are an ops-rare action, so a 5-minute edge cache + 10-minute stale window
// keeps the request budget low.
export const DEMO_API_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
} as const;

// Returns the configured demo family's id, or null if no row is flagged. The
// partial unique index `league_families_demo_singleton` guarantees at most one
// row qualifies.
export async function getDemoFamilyId(): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.leagueFamilies.id })
    .from(schema.leagueFamilies)
    .where(eq(schema.leagueFamilies.demoEligible, true))
    .limit(1);
  return rows[0]?.id ?? null;
}
