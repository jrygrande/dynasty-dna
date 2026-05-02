import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { sendConfirmation } from "@/lib/email";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const SWEEP_THRESHOLD = 1024;

const ipBuckets = new Map<string, { count: number; resetAt: number }>();

function sweepExpired(map: Map<string, { resetAt: number }>, now: number) {
  if (map.size < SWEEP_THRESHOLD) return;
  for (const [k, v] of map) {
    if (v.resetAt < now) map.delete(k);
  }
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

function rateLimitCheck(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  sweepExpired(ipBuckets, now);
  const bucket = ipBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEAGUE_ID_REGEX = /^\d{18,20}$/;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimitCheck(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a minute." },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      }
    );
  }

  let body: {
    email?: unknown;
    league_id?: unknown;
    league_name?: unknown;
    hp?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Honeypot — silently accept and skip persistence + send.
  if (typeof body.hp === "string" && body.hp.length > 0) {
    return NextResponse.json({ ok: true, status: "created" });
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const leagueId = typeof body.league_id === "string" ? body.league_id : "";
  if (!LEAGUE_ID_REGEX.test(leagueId)) {
    return NextResponse.json({ error: "Invalid league_id" }, { status: 400 });
  }

  const leagueName =
    typeof body.league_name === "string" ? body.league_name.trim() : "";
  if (!leagueName || leagueName.length > 100) {
    return NextResponse.json({ error: "Invalid league_name" }, { status: 400 });
  }

  let status: "created" | "updated";
  let currentCapacity = 0;
  try {
    const db = getDb();
    // xmax = 0 on a row means it was just inserted (no prior tuple version).
    // Non-zero xmax means the ON CONFLICT update path was taken.
    const upsertResult = await db.execute(sql`
      INSERT INTO ${schema.waitlist} (email, league_id)
      VALUES (${email}, ${leagueId})
      ON CONFLICT (email, league_id) DO UPDATE SET created_at = now()
      RETURNING (xmax = 0) AS inserted
    `);
    const inserted = (upsertResult.rows?.[0] as { inserted?: boolean } | undefined)
      ?.inserted;
    status = inserted ? "created" : "updated";

    const countRow = await db.execute(sql`
      SELECT (
        (SELECT COUNT(DISTINCT league_id) FROM ${schema.leagueFamilyMembers})
        +
        (SELECT COUNT(DISTINCT league_id) FROM ${schema.waitlist}
         WHERE status = 'pending'
           AND league_id NOT IN (SELECT league_id FROM ${schema.leagueFamilyMembers}))
      )::int AS current
    `);
    const currentValue = (countRow.rows?.[0] as { current?: number } | undefined)
      ?.current;
    currentCapacity = typeof currentValue === "number" ? currentValue : 0;
  } catch (err) {
    console.error("[waitlist] DB error", err);
    return NextResponse.json(
      { error: "Something went wrong on our end. Try refreshing." },
      { status: 500 }
    );
  }

  try {
    await sendConfirmation({ to: email, leagueName, currentCapacity });
  } catch (err) {
    console.error("[waitlist] Resend send failed", err);
    // Swallow — row is stored; CLI notify is the eventual source of truth.
  }

  return NextResponse.json({ ok: true, status });
}
