import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";

/**
 * Resolve a familyId path param to the canonical family UUID.
 *
 * Accepts any of:
 *   1. The family UUID (`league_families.id`)
 *   2. The family's rootLeagueId (`league_families.root_league_id`)
 *   3. Any member league's leagueId (`league_family_members.league_id`)
 *
 * Returns null if no matching family is found.
 *
 * Why (3): the dashboard links to the *current* Sleeper league_id, which can
 * drift away from `rootLeagueId` after a season rollover if the family was
 * synced before the new season's id existed.
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

  const byRoot = await db
    .select()
    .from(schema.leagueFamilies)
    .where(eq(schema.leagueFamilies.rootLeagueId, familyId))
    .limit(1);
  if (byRoot.length > 0) return byRoot[0].id;

  const byMember = await db
    .select({ familyId: schema.leagueFamilyMembers.familyId })
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.leagueId, familyId))
    .limit(1);
  if (byMember.length > 0) return byMember[0].familyId;

  return null;
}
