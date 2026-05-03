import type { NextRequest } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  buildDemoMap,
  DEMO_SEED_COOKIE,
  type DemoMap,
  type ManagerInput,
  type RosterInput,
} from "@/lib/demoAnonymize";
import { getDemoFamilyId } from "@/lib/demoFamily";

export { DEMO_SEED_COOKIE };
// Cookie outlives a tab close (sessionStorage didn't). 24h is long enough
// for a typical browse session and short enough that a stale flag doesn't
// hang around forever.
export const DEMO_COOKIE_MAX_AGE = 60 * 60 * 24;

// What the league is called when demo mode is active. Plays on AA + the
// NFL-coach pseudonyms — sounds like a real dynasty league with a wink.
export const DEMO_LEAGUE_NAME = "Coaches Anonymous";

interface DemoInputs {
  familyId: string;
  managers: ManagerInput[];
  rosters: RosterInput[];
}

let cachedInputs: DemoInputs | null = null;
let cachedAt = 0;
const INPUTS_TTL_MS = 5 * 60 * 1000;

export function readDemoSeedFromRequest(req: NextRequest): string | null {
  return req.cookies.get(DEMO_SEED_COOKIE)?.value ?? null;
}

// Loads (managers, rosters) for the demo family. Cached because every API
// request in demo mode would otherwise re-issue the same queries.
async function loadDemoInputs(familyId: string): Promise<DemoInputs> {
  const now = Date.now();
  if (cachedInputs?.familyId === familyId && now - cachedAt < INPUTS_TTL_MS) {
    return cachedInputs;
  }

  const db = getDb();

  const members = await db
    .select({
      leagueId: schema.leagueFamilyMembers.leagueId,
      season: schema.leagueFamilyMembers.season,
    })
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, familyId));

  if (members.length === 0) {
    const empty: DemoInputs = { familyId, managers: [], rosters: [] };
    cachedInputs = empty;
    cachedAt = now;
    return empty;
  }

  const sortedMembers = members
    .slice()
    .sort((a, b) => Number(b.season) - Number(a.season));
  const currentLeagueId = sortedMembers[0].leagueId;
  const allLeagueIds = members.map((m) => m.leagueId);

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
          eq(schema.managerMetrics.metric, "manager_process_score"),
          eq(schema.managerMetrics.scope, "all_time")
        )
      )
      .orderBy(desc(schema.managerMetrics.computedAt)),
  ]);

  const scoreByManager = new Map<string, number>();
  for (const m of metrics) {
    if (!scoreByManager.has(m.managerId)) {
      scoreByManager.set(m.managerId, m.value);
    }
  }

  const managerIds = Array.from(
    new Set(rosters.map((r) => r.ownerId).filter((x): x is string => !!x))
  );

  const inputs: DemoInputs = {
    familyId,
    managers: managerIds.map((userId) => ({
      userId,
      score: scoreByManager.has(userId) ? scoreByManager.get(userId)! : null,
    })),
    rosters: rosters.map((r) => ({
      rosterId: r.rosterId,
      ownerId: r.ownerId,
    })),
  };

  cachedInputs = inputs;
  cachedAt = now;
  return inputs;
}

// Resolves the demo swap for an API request. Returns null when the request
// isn't for the demo family or no seed cookie is present, in which case the
// route should respond with real data unchanged.
export async function getDemoSwapForRequest(
  req: NextRequest,
  familyId: string
): Promise<DemoMap | null> {
  const seed = readDemoSeedFromRequest(req);
  if (!seed) return null;

  const demoFamilyId = await getDemoFamilyId();
  if (!demoFamilyId || demoFamilyId !== familyId) return null;

  const inputs = await loadDemoInputs(demoFamilyId);
  return buildDemoMap(inputs.managers, inputs.rosters, seed);
}

// Variant for routes whose familyId isn't a parameter — graph callers, etc.
// Returns the swap if the demo cookie is present AND the demo family is
// configured. Caller must confirm the familyId matches before applying.
export async function getDemoSwapIfActive(
  req: NextRequest
): Promise<{ familyId: string; map: DemoMap } | null> {
  const seed = readDemoSeedFromRequest(req);
  if (!seed) return null;
  const demoFamilyId = await getDemoFamilyId();
  if (!demoFamilyId) return null;
  const inputs = await loadDemoInputs(demoFamilyId);
  return { familyId: demoFamilyId, map: buildDemoMap(inputs.managers, inputs.rosters, seed) };
}
