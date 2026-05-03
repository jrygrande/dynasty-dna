import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

// Cache headers used by the public /api/demo/* routes. Demo singleton flips
// are an ops-rare action, so a 5-minute edge cache + 10-minute stale window
// keeps the request budget low.
export const DEMO_API_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
} as const;

const FAMILY_ID_TTL_MS = 5 * 60 * 1000;
let cachedFamilyId: { value: string | null; ts: number } | null = null;

// Returns the configured demo family's id, or null if no row is flagged. The
// partial unique index `league_families_demo_singleton` guarantees at most
// one row qualifies. Memoized in-process for 5 min — admin flips tolerate
// up to that latency before propagating.
export async function getDemoFamilyId(): Promise<string | null> {
  const now = Date.now();
  if (cachedFamilyId && now - cachedFamilyId.ts < FAMILY_ID_TTL_MS) {
    return cachedFamilyId.value;
  }
  const db = getDb();
  const rows = await db
    .select({ id: schema.leagueFamilies.id })
    .from(schema.leagueFamilies)
    .where(eq(schema.leagueFamilies.demoEligible, true))
    .limit(1);
  const value = rows[0]?.id ?? null;
  cachedFamilyId = { value, ts: now };
  return value;
}
