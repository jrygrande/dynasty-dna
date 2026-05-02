import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { Sleeper } from "@/lib/sleeper";

interface FoundLeague {
  league_id: string;
  family_id: string | null;
  name: string;
  season: string;
  avatar: string | null;
}

interface FindLeaguesResponse {
  username: string;
  user_id: string;
  leagues: FoundLeague[];
  total_league_count: number;
}

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RESPONSE_CACHE_TTL_MS = 60_000;
const SWEEP_THRESHOLD = 1024;
const DYNASTY_LEAGUE_TYPE = 2;

const ipBuckets = new Map<string, { count: number; resetAt: number }>();
const responseCache = new Map<
  string,
  { value: FindLeaguesResponse; expiresAt: number }
>();

function sweepExpired<T extends { resetAt?: number; expiresAt?: number }>(
  map: Map<string, T>,
  now: number
) {
  if (map.size < SWEEP_THRESHOLD) return;
  for (const [k, v] of map) {
    const exp = v.resetAt ?? v.expiresAt ?? 0;
    if (exp < now) map.delete(k);
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

const SLEEPER_DOWN = NextResponse.json(
  { error: "Sleeper's API isn't responding. Try again in a moment." },
  { status: 502 }
);

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

  let body: { username?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const rawUsername =
    typeof body.username === "string" ? body.username.trim() : "";
  if (!rawUsername || !/^[\w\-.]{1,32}$/.test(rawUsername)) {
    return NextResponse.json({ error: "Invalid username" }, { status: 400 });
  }
  const username = rawUsername.toLowerCase();

  const now = Date.now();
  sweepExpired(responseCache, now);
  const cached = responseCache.get(username);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.value);
  }

  const [userRes, nflStateRes] = await Promise.allSettled([
    Sleeper.getUserByUsername(username),
    Sleeper.getNFLState(),
  ]);

  if (userRes.status === "rejected") {
    return SLEEPER_DOWN;
  }
  const user = userRes.value;
  if (!user || !user.user_id) {
    return NextResponse.json(
      { error: `We couldn't find @${username} on Sleeper.` },
      { status: 404 }
    );
  }
  if (nflStateRes.status === "rejected") {
    return SLEEPER_DOWN;
  }
  const currentSeason = String(nflStateRes.value.season);

  let userLeagues;
  try {
    userLeagues = await Sleeper.getLeaguesByUser(user.user_id, currentSeason);
  } catch {
    return SLEEPER_DOWN;
  }
  const totalLeagueCount = userLeagues?.length ?? 0;

  const dynastyLeagues = (userLeagues || []).filter((l) => {
    const t = (l.settings as Record<string, unknown> | undefined)?.type;
    return t === DYNASTY_LEAGUE_TYPE;
  });

  const familyMap = new Map<string, string>();
  if (dynastyLeagues.length > 0) {
    try {
      const db = getDb();
      const leagueIds = dynastyLeagues.map((l) => l.league_id);
      const matched = await db
        .select({
          familyId: schema.leagueFamilyMembers.familyId,
          leagueId: schema.leagueFamilyMembers.leagueId,
        })
        .from(schema.leagueFamilyMembers)
        .where(inArray(schema.leagueFamilyMembers.leagueId, leagueIds));
      for (const row of matched) {
        familyMap.set(row.leagueId, row.familyId);
      }
    } catch {
      return NextResponse.json(
        { error: "Something went wrong on our end. Try refreshing." },
        { status: 500 }
      );
    }
  }

  const response: FindLeaguesResponse = {
    username,
    user_id: user.user_id,
    leagues: dynastyLeagues.map((l) => ({
      league_id: l.league_id,
      family_id: familyMap.get(l.league_id) ?? null,
      name: l.name,
      season: l.season,
      avatar:
        (l as unknown as { avatar?: string | null }).avatar ?? null,
    })),
    total_league_count: totalLeagueCount,
  };

  responseCache.set(username, {
    value: response,
    expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
  });

  return NextResponse.json(response);
}
