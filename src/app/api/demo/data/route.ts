import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { DEMO_API_CACHE_HEADERS, getDemoFamilyId } from "@/lib/demoFamily";

// Returns the inputs needed by useDemoMap() to compute the per-session
// anonymization mapping client-side: the singleton demo family, its current
// managers (with overall_score), and rosters. Single endpoint to keep the
// hook's request count low; cached for 5 minutes.
export async function GET() {
  const db = getDb();

  const familyId = await getDemoFamilyId();
  if (!familyId) {
    return NextResponse.json(
      { family_id: null, managers: [], rosters: [] },
      { headers: DEMO_API_CACHE_HEADERS }
    );
  }

  // Most recent league in the family — its rosters and manager_metrics drive
  // the mapping. Roster ids are stable across seasons for the demo league;
  // this avoids ambiguity if a past season had different membership.
  const members = await db
    .select({
      leagueId: schema.leagueFamilyMembers.leagueId,
      season: schema.leagueFamilyMembers.season,
    })
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, familyId));

  if (members.length === 0) {
    return NextResponse.json(
      { family_id: familyId, managers: [], rosters: [] },
      { headers: DEMO_API_CACHE_HEADERS }
    );
  }

  const sortedMembers = members
    .slice()
    .sort((a, b) => Number(b.season) - Number(a.season));
  const currentLeagueId = sortedMembers[0].leagueId;
  const allLeagueIds = members.map((m) => m.leagueId);

  // Pull all_time overall_score from any league in the family — values are
  // identical for "all_time" scope, but using inArray means we tolerate the
  // current league not having metrics computed yet.
  const [rosters, metrics] = await Promise.all([
    db
      .select({
        rosterId: schema.rosters.rosterId,
        ownerId: schema.rosters.ownerId,
      })
      .from(schema.rosters)
      .where(eq(schema.rosters.leagueId, currentLeagueId)),
    db
      .select({
        managerId: schema.managerMetrics.managerId,
        value: schema.managerMetrics.value,
      })
      .from(schema.managerMetrics)
      .where(
        and(
          inArray(schema.managerMetrics.leagueId, allLeagueIds),
          eq(schema.managerMetrics.metric, "overall_score"),
          eq(schema.managerMetrics.scope, "all_time")
        )
      )
      .orderBy(desc(schema.managerMetrics.computedAt)),
  ]);

  // Last write wins per managerId.
  const scoreByManager = new Map<string, number>();
  for (const m of metrics) {
    if (!scoreByManager.has(m.managerId)) {
      scoreByManager.set(m.managerId, m.value);
    }
  }

  // Manager set is the union of current-league owners — that's who renders.
  const managerIds = Array.from(
    new Set(rosters.map((r) => r.ownerId).filter((x): x is string => !!x))
  );
  const managers = managerIds.map((userId) => ({
    userId,
    score: scoreByManager.has(userId) ? scoreByManager.get(userId)! : null,
  }));

  return NextResponse.json(
    {
      family_id: familyId,
      managers,
      rosters: rosters.map((r) => ({
        rosterId: r.rosterId,
        ownerId: r.ownerId,
      })),
    },
    { headers: DEMO_API_CACHE_HEADERS }
  );
}
