/**
 * CLI: notify all pending waitlist rows for a league family.
 *
 * Usage:
 *   npm run notify-waitlist -- --family-id <UUID>
 *   npx tsx scripts/notify-waitlist.ts --family-id <UUID>
 *
 * Behaviour:
 *   - Resolves family_id → set of member league_ids
 *   - Selects all `pending` waitlist rows whose league_id is in that set
 *   - Sends notify email per row, with 100ms spacing
 *   - On 429: exponential backoff (1s, 2s, 4s, 8s) up to 4 retries
 *   - On daily-cap exhaustion: logs unsent IDs and exits 0 (re-runnable)
 *   - On per-row send success: updates status='notified', notified_at=now()
 *
 * Idempotent: re-running skips already-notified rows.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { notifyWaitlist } from "../src/lib/notifyWaitlist";

function parseArgs(argv: string[]): { familyId: string | null } {
  let familyId: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--family-id" && i + 1 < argv.length) {
      familyId = argv[i + 1];
      i++;
    } else if (a.startsWith("--family-id=")) {
      familyId = a.slice("--family-id=".length);
    }
  }
  return { familyId };
}

async function main() {
  const { familyId } = parseArgs(process.argv.slice(2));
  if (!familyId) {
    console.error("Missing --family-id <UUID>");
    process.exit(2);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(2);
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set");
    process.exit(2);
  }

  const db = drizzle(neon(url), { schema });

  const summary = await notifyWaitlist({
    familyId,
    db: {
      getMembers: async (fid) => {
        const rows = await db
          .select({
            leagueId: schema.leagueFamilyMembers.leagueId,
          })
          .from(schema.leagueFamilyMembers)
          .where(eq(schema.leagueFamilyMembers.familyId, fid));
        return rows.map((r) => r.leagueId);
      },
      getPending: async (leagueIds) => {
        if (leagueIds.length === 0) return [];
        const rows = await db
          .select({
            id: schema.waitlist.id,
            email: schema.waitlist.email,
            leagueId: schema.waitlist.leagueId,
          })
          .from(schema.waitlist)
          .where(
            and(
              eq(schema.waitlist.status, "pending"),
              inArray(schema.waitlist.leagueId, leagueIds)
            )
          );
        return rows;
      },
      getLeagueName: async (leagueId) => {
        const rows = await db
          .select({ name: schema.leagues.name })
          .from(schema.leagues)
          .where(eq(schema.leagues.id, leagueId))
          .limit(1);
        return rows[0]?.name ?? null;
      },
      markNotified: async (id) => {
        await db
          .update(schema.waitlist)
          .set({ status: "notified", notifiedAt: new Date() })
          .where(eq(schema.waitlist.id, id));
      },
    },
  });

  console.log(
    `notify-waitlist: ${summary.notified} sent, ${summary.skipped} skipped, ${summary.unsent.length} unsent`
  );
  if (summary.unsent.length > 0) {
    console.log("Unsent waitlist row IDs:");
    for (const id of summary.unsent) console.log(`  ${id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
