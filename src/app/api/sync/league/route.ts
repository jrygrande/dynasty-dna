import { NextRequest, NextResponse } from "next/server";
import { syncLeagueFamily } from "@/services/sync";
import { ensureLeagueFamily } from "@/services/leagueFamily";
import { acquireSyncLock, releaseSyncLock } from "@/services/syncLock";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { isAuthorizedCron, isSameOriginRequest } from "@/app/api/cron/_lib/auth";

export async function POST(req: NextRequest) {
  // /api/sync/league has two legitimate callers:
  //   1. Operators hitting it via curl with `Authorization: Bearer $CRON_SECRET`
  //   2. The in-app auto-warm in src/app/(app)/league/[familyId]/page.tsx,
  //      which is a same-origin browser fetch
  //
  // Bearer-only would 401 the in-app caller (browser can't safely send the
  // server secret). Same-origin alone wouldn't block direct curl from the
  // public internet. So we accept either — bearer for ops, same-origin
  // (verified via Origin header against Host) for the browser.
  if (!isAuthorizedCron(req) && !isSameOriginRequest(req)) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401 }
    );
  }

  const { leagueId } = await req.json();
  if (!leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 }
    );
  }

  try {
    // Ensure the league family exists (discovers all seasons via Sleeper API)
    const familyId = await ensureLeagueFamily(leagueId);

    // Acquire sync lock — return 409 if already running. The /api/sync/league
    // route is the manual entry point (button click in UI / direct call), so
    // we record trigger=manual on the audit row.
    const jobId = await acquireSyncLock(leagueId, { trigger: "manual" });
    if (!jobId) {
      return NextResponse.json(
        { error: "A sync is already running for this league family" },
        { status: 409 }
      );
    }

    try {
      // Get all league IDs in the family, sorted oldest-first
      const db = getDb();
      const members = await db
        .select()
        .from(schema.leagueFamilyMembers)
        .where(eq(schema.leagueFamilyMembers.familyId, familyId));

      const allLeagueIds = members
        .sort((a, b) => Number(a.season) - Number(b.season))
        .map((m) => m.leagueId);

      if (allLeagueIds.length === 0) {
        // Fallback: sync just the requested league
        await syncLeagueFamily([leagueId], undefined, familyId, {
          trigger: "manual",
        });
      } else {
        // Sync all seasons in the family
        await syncLeagueFamily(allLeagueIds, undefined, familyId, {
          trigger: "manual",
        });
      }

      await releaseSyncLock(jobId, "success");

      return NextResponse.json({
        success: true,
        familyId,
        seasonsSynced: allLeagueIds.length || 1,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      await releaseSyncLock(jobId, "failed", message);
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
