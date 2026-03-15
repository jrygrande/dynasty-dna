import { NextRequest, NextResponse } from "next/server";
import { syncRosterStatus } from "@/services/rosterStatusSync";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;
    const seasons: number[] | undefined = body?.seasons;

    const result = await syncRosterStatus({ seasons, force });

    return NextResponse.json({
      success: true,
      message: `Synced ${result.total} roster status records`,
      ...result,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Roster status sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
