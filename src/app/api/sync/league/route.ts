import { NextRequest, NextResponse } from "next/server";
import { syncLeague, syncLeagueFamily } from "@/services/sync";
import { ensureLeagueFamily } from "@/services/leagueFamily";
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
      await syncLeague(leagueId);
    } else {
      // Sync all seasons in the family
      await syncLeagueFamily(allLeagueIds);
    }

    return NextResponse.json({
      success: true,
      familyId,
      seasonsSynced: allLeagueIds.length || 1,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
