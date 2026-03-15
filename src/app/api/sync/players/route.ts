import { NextRequest, NextResponse } from "next/server";
import { syncPlayers } from "@/services/playerSync";

export async function POST(req: NextRequest) {
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
