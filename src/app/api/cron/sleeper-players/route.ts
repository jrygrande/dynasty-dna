// Daily cron: refresh the Sleeper player dictionary.
//
// Schedule: 06:00 UTC daily (vercel.json crons).
// Calls `syncPlayers(force: true)` so the staleness gate is bypassed and
// late-day Sleeper updates always land. Idempotent: re-running the same
// tick simply re-upserts the same rows.

import { NextRequest } from "next/server";
import { syncPlayers } from "@/services/playerSync";
import { runCron } from "../_lib/runCron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return runCron(
    req,
    { name: "sleeper-players", source: "sleeper", scope: "sleeper-players" },
    async () => {
      const synced = await syncPlayers(true);
      return {
        callsMade: 1, // single Sleeper API call: GET /players/nfl
        summary: { synced },
      };
    }
  );
}
