/**
 * POST /api/sync/start (#151)
 *
 * Allocates (or reuses) a `syncJobs` row for a family so the cold-start
 * loading screen can poll a stable `jobId`. Idempotent by design:
 *
 *   - If a non-stale `running` job already exists for the family root,
 *     return its id. Two visitors hitting `/league/[familyId]` at the
 *     same time share one job; both get the same progress.
 *   - Otherwise, acquire a new lock with `trigger: "lazy"` and hand back
 *     the new id.
 *
 * The actual chunked work happens in `/api/sync/jobs/[jobId]/tick` — this
 * route just guarantees the row exists so the client has something to
 * poll.
 *
 * Body: `{ familyId: string }` — accepts any of the forms understood by
 * `resolveFamily` (uuid, root league id, member league id).
 *
 * Errors:
 *   - 400: missing or unresolvable familyId
 *   - 500: unexpected — never expose stack traces
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { resolveFamily } from "@/lib/familyResolution";
import { getDb, schema } from "@/db";
import { acquireSyncLock } from "@/services/syncLock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_MS = 10 * 60 * 1000;

async function findRunningJobId(ref: string): Promise<string | null> {
  const db = getDb();
  const staleThreshold = new Date(Date.now() - STALE_MS);
  const rows = await db
    .select({ id: schema.syncJobs.id })
    .from(schema.syncJobs)
    .where(
      sql`${schema.syncJobs.ref} = ${ref} AND ${schema.syncJobs.status} = 'running' AND ${schema.syncJobs.startedAt} > ${staleThreshold}`
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

async function getFamilyRootRef(familyId: string): Promise<string | null> {
  const db = getDb();
  const family = await db
    .select({ rootLeagueId: schema.leagueFamilies.rootLeagueId })
    .from(schema.leagueFamilies)
    .where(eq(schema.leagueFamilies.id, familyId))
    .limit(1);
  if (family.length > 0 && family[0].rootLeagueId) {
    return family[0].rootLeagueId;
  }
  // Fallback: use the most-recent member league.
  const members = await db
    .select({
      leagueId: schema.leagueFamilyMembers.leagueId,
      season: schema.leagueFamilyMembers.season,
    })
    .from(schema.leagueFamilyMembers)
    .where(eq(schema.leagueFamilyMembers.familyId, familyId))
    .orderBy(sql`${schema.leagueFamilyMembers.season} DESC`)
    .limit(1);
  return members[0]?.leagueId ?? null;
}

export async function POST(req: NextRequest) {
  let body: { familyId?: string } = {};
  try {
    body = (await req.json()) as { familyId?: string };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { familyId: input } = body;
  if (!input || typeof input !== "string") {
    return NextResponse.json(
      { error: "familyId is required" },
      { status: 400 }
    );
  }

  const familyId = await resolveFamily(input);
  if (!familyId) {
    return NextResponse.json(
      { error: "Unknown family" },
      { status: 404 }
    );
  }

  const ref = await getFamilyRootRef(familyId);
  if (!ref) {
    return NextResponse.json(
      { error: "Family has no member leagues" },
      { status: 404 }
    );
  }

  // Reuse an in-flight job if one exists. The chunked tick route is
  // idempotent on resume, so two callers polling the same jobId is fine.
  const existing = await findRunningJobId(ref);
  if (existing) {
    return NextResponse.json({ jobId: existing, familyId, reused: true });
  }

  const jobId = await acquireSyncLock(ref, { trigger: "lazy" });
  if (!jobId) {
    // Race: someone else acquired between our find + acquire. Look it up
    // again so the client never sees a 409 here — the tick loop will
    // resume the in-flight job.
    const racy = await findRunningJobId(ref);
    if (racy) {
      return NextResponse.json({ jobId: racy, familyId, reused: true });
    }
    return NextResponse.json(
      { error: "Failed to acquire sync lock" },
      { status: 500 }
    );
  }

  return NextResponse.json({ jobId, familyId, reused: false });
}
