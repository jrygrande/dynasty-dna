import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";

/**
 * Resolve a familyId (UUID or rootLeagueId) to the canonical family UUID.
 * Returns null if no matching family is found.
 */
export async function resolveFamily(familyId: string): Promise<string | null> {
  const db = getDb();

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(familyId);

  if (isUuid) {
    const family = await db
      .select()
      .from(schema.leagueFamilies)
      .where(eq(schema.leagueFamilies.id, familyId))
      .limit(1);
    if (family.length > 0) return family[0].id;
  }

  const family = await db
    .select()
    .from(schema.leagueFamilies)
    .where(eq(schema.leagueFamilies.rootLeagueId, familyId))
    .limit(1);
  if (family.length > 0) return family[0].id;

  return null;
}
