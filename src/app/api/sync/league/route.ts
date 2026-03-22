import { NextRequest, NextResponse } from "next/server";
import { syncLeagueFamily } from "@/services/sync";
import { ensureLeagueFamily } from "@/services/leagueFamily";
import { acquireSyncLock, releaseSyncLock } from "@/services/syncLock";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
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

    // Acquire sync lock — return 409 if already running
    const jobId = await acquireSyncLock(leagueId);
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
        await syncLeagueFamily([leagueId], undefined, familyId);
      } else {
        // Sync all seasons in the family
        await syncLeagueFamily(allLeagueIds, undefined, familyId);
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
