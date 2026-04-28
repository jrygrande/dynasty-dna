import { NextRequest, NextResponse } from "next/server";
import { computePlayerStintStats } from "@/services/playerStintStats";

/**
 * GET /api/leagues/[familyId]/player/[playerId]/stint-stats
 *
 * Returns stint-scoped aggregates (PPG, PPG-while-starting, Start %, Active %)
 * for a player on a single manager's roster across a date window. Bye weeks
 * are excluded from rate denominators.
 *
 * Query params (all required except endSeason/endWeek for ongoing stints):
 *   ?managerUserId=123456789
 *   &startSeason=2024
 *   &startWeek=1
 *   &endSeason=2024     — omit for ongoing
 *   &endWeek=14         — omit for ongoing
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string; playerId: string } },
) {
  const { familyId, playerId } = params;
  const sp = req.nextUrl.searchParams;

  const managerUserId = sp.get("managerUserId");
  const startSeason = sp.get("startSeason");
  const startWeekRaw = sp.get("startWeek");
  const endSeason = sp.get("endSeason");
  const endWeekRaw = sp.get("endWeek");

  if (!managerUserId || !startSeason || !startWeekRaw) {
    return NextResponse.json(
      { error: "managerUserId, startSeason, and startWeek are required" },
      { status: 400 },
    );
  }

  const startWeek = parseInt(startWeekRaw, 10);
  const endWeek = endWeekRaw ? parseInt(endWeekRaw, 10) : null;
  if (Number.isNaN(startWeek)) {
    return NextResponse.json(
      { error: "startWeek must be an integer" },
      { status: 400 },
    );
  }

  const stats = await computePlayerStintStats({
    familyId,
    playerId,
    managerUserId,
    startSeason,
    startWeek,
    endSeason: endSeason || null,
    endWeek,
  });

  if (!stats) {
    return NextResponse.json({ error: "Family not found" }, { status: 404 });
  }

  return NextResponse.json(stats);
}
