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

interface SleeperPayload {
  user_id: string;
  total_league_count: number;
  dynastyLeagues: Array<{
    league_id: string;
    name: string;
    season: string;
    avatar: string | null;
  }>;
}

const RESPONSE_CACHE_TTL_MS = 60_000;
const DYNASTY_LEAGUE_TYPE = 2;

const rateLimit = createIpRateLimiter({ max: 10, windowMs: 60_000 });
// Caches only the Sleeper-derived shape — family + waitlist state are queried
// fresh per request so writes (cleanup, new waitlist rows) become visible
// immediately across all users, not after this username's TTL expires.
const responseCache = new Map<
  string,
  { value: SleeperPayload; expiresAt: number }
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
  let sleeperPayload: SleeperPayload | null =
    cached && cached.expiresAt > now ? cached.value : null;

  if (!sleeperPayload) {
    const [userRes, nflStateRes] = await Promise.allSettled([
      Sleeper.getUserByUsername(username),
      Sleeper.getNFLState(),
    ]);

    if (userRes.status === "rejected") return SLEEPER_DOWN;
    const user = userRes.value;
    if (!user || !user.user_id) {
      return NextResponse.json(
        { error: `We couldn't find @${username} on Sleeper.` },
        { status: 404 }
      );
    }
    if (nflStateRes.status === "rejected") return SLEEPER_DOWN;
    const currentSeason = String(nflStateRes.value.season);

    let userLeagues;
    try {
      userLeagues = await Sleeper.getLeaguesByUser(user.user_id, currentSeason);
    } catch {
      return SLEEPER_DOWN;
    }

    const dynastyLeagues = (userLeagues || [])
      .filter((l) => {
        const t = (l.settings as Record<string, unknown> | undefined)?.type;
        return t === DYNASTY_LEAGUE_TYPE;
      })
      .map((l) => ({
        league_id: l.league_id,
        name: l.name,
        season: l.season,
        avatar: (l as unknown as { avatar?: string | null }).avatar ?? null,
      }));

    sleeperPayload = {
      user_id: user.user_id,
      total_league_count: userLeagues?.length ?? 0,
      dynastyLeagues,
    };
    responseCache.set(username, {
      value: sleeperPayload,
      expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
    });
  }

  const familyMap = new Map<string, string>();
  const waitlistedSet = new Set<string>();
  if (sleeperPayload.dynastyLeagues.length > 0) {
    try {
      const db = getDb();
      const leagueIds = sleeperPayload.dynastyLeagues.map((l) => l.league_id);
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
    user_id: sleeperPayload.user_id,
    leagues: sleeperPayload.dynastyLeagues.map((l) => ({
      league_id: l.league_id,
      family_id: familyMap.get(l.league_id) ?? null,
      name: l.name,
      season: l.season,
      avatar: l.avatar,
      waitlisted: waitlistedSet.has(l.league_id),
    })),
    total_league_count: sleeperPayload.total_league_count,
  };

  return NextResponse.json(response);
}
