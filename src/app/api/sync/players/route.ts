import { NextRequest, NextResponse } from "next/server";
import { syncPlayers } from "@/services/playerSync";
import { isAuthorizedCron } from "@/app/api/cron/_lib/auth";

export async function POST(req: NextRequest) {
  // Admin-only: no in-app caller, bearer-required.
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;

    const count = await syncPlayers(force);

    if (count === 0) {
      return NextResponse.json({
        success: true,
        message: "Player data is fresh, sync skipped",
        synced: 0,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${count} players`,
      synced: count,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Player sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
