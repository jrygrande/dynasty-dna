import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { Sleeper } from "@/lib/sleeper";
import { createIpRateLimiter, getClientIp } from "@/lib/ipRateLimit";

interface FoundLeague {
  league_id: string;
  family_id: string | null;
  name: string;
  season: string;
  avatar: string | null;
  waitlisted: boolean;
}

interface FindLeaguesResponse {
  username: string;
  user_id: string;
  leagues: FoundLeague[];
  total_league_count: number;
}

const RESPONSE_CACHE_TTL_MS = 60_000;
const DYNASTY_LEAGUE_TYPE = 2;

const rateLimit = createIpRateLimiter({ max: 10, windowMs: 60_000 });
const responseCache = new Map<
  string,
  { value: FindLeaguesResponse; expiresAt: number }
>();

function sweepCacheExpired(now: number) {
  if (responseCache.size < 1024) return;
  for (const [k, v] of responseCache) {
    if (v.expiresAt < now) responseCache.delete(k);
  }
}

const SLEEPER_DOWN = NextResponse.json(
  { error: "Sleeper's API isn't responding. Try again in a moment." },
  { status: 502 }
);

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(ip);
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
  sweepCacheExpired(now);
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
  const waitlistedSet = new Set<string>();
  if (dynastyLeagues.length > 0) {
    try {
      const db = getDb();
      const leagueIds = dynastyLeagues.map((l) => l.league_id);
      const [matched, waitlisted] = await Promise.all([
        db
          .select({
            familyId: schema.leagueFamilyMembers.familyId,
            leagueId: schema.leagueFamilyMembers.leagueId,
          })
          .from(schema.leagueFamilyMembers)
          .where(inArray(schema.leagueFamilyMembers.leagueId, leagueIds)),
        db
          .select({ leagueId: schema.waitlist.leagueId })
          .from(schema.waitlist)
          .where(
            and(
              eq(schema.waitlist.status, "pending"),
              inArray(schema.waitlist.leagueId, leagueIds)
            )
          ),
      ]);
      for (const row of matched) {
        familyMap.set(row.leagueId, row.familyId);
      }
      for (const row of waitlisted) {
        if (!familyMap.has(row.leagueId)) waitlistedSet.add(row.leagueId);
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
      waitlisted: waitlistedSet.has(l.league_id),
    })),
    total_league_count: totalLeagueCount,
  };

  responseCache.set(username, {
    value: response,
    expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
  });

  return NextResponse.json(response);
}
