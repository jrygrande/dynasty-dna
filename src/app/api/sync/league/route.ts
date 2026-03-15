import { NextRequest, NextResponse } from "next/server";
import { syncLeague } from "@/services/sync";
import { ensureLeagueFamily } from "@/services/leagueFamily";

export async function POST(req: NextRequest) {
  const { leagueId } = await req.json();
  if (!leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 }
    );
  }

  try {
    // Ensure the league family exists
    const familyId = await ensureLeagueFamily(leagueId);

    // Sync the league data
    await syncLeague(leagueId);

    return NextResponse.json({ success: true, familyId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
