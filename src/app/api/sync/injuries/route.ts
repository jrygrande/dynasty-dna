import { NextRequest, NextResponse } from "next/server";
import { syncInjuries } from "@/services/injurySync";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;
    const seasons: number[] | undefined = body?.seasons;

    const result = await syncInjuries({ seasons, force });

    return NextResponse.json({
      success: true,
      message: `Synced ${result.total} injury records`,
      ...result,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Injury sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
