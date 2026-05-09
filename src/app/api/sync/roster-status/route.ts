import { NextRequest, NextResponse } from "next/server";
import { syncRosterStatus } from "@/services/rosterStatusSync";
import { isAuthorizedCron } from "@/app/api/cron/_lib/auth";

export async function POST(req: NextRequest) {
  // Admin-only: no in-app caller, bearer-required.
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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
