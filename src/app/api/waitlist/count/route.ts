import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

export const revalidate = 60;

export async function GET() {
  try {
    const db = getDb();
    const result = await db.execute(sql`
      SELECT (
        (SELECT COUNT(DISTINCT league_id) FROM ${schema.leagueFamilyMembers})
        +
        (SELECT COUNT(DISTINCT league_id) FROM ${schema.waitlist}
         WHERE status = 'pending'
           AND league_id NOT IN (SELECT league_id FROM ${schema.leagueFamilyMembers}))
      )::int AS current
    `);
    const current =
      (result.rows?.[0] as { current?: number } | undefined)?.current ?? 0;
    return NextResponse.json(
      { current },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  } catch (err) {
    console.error("[waitlist/count] DB error", err);
    return NextResponse.json({ current: 0 });
  }
}
