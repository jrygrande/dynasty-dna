import { Sleeper } from "@/lib/sleeper";
import { getDb, schema } from "@/db";
import { and, eq, sql } from "drizzle-orm";
import { batchInsert } from "@/services/batchHelper";

const USERS_WATERMARK_TYPE = "users";
export const STALE_USERS_MS = 24 * 60 * 60 * 1000;

/**
 * Refresh league_users (display name, team name, avatar hash) for one league
 * from Sleeper. Bumps the `users` watermark on success.
 *
 * Sleeper avatars are stored as a hash, not a stable URL — when a user updates
 * their avatar Sleeper rotates the hash, so cached values drift even though
 * the CDN URL pattern itself is stable. This sync writes the fresh hash back.
 */
export async function syncLeagueUsers(leagueId: string): Promise<void> {
  const users = await Sleeper.getLeagueUsers(leagueId);
  if (users.length > 0) {
    await batchInsert(
      schema.leagueUsers,
      users.map((user) => ({
        leagueId,
        userId: user.user_id,
        displayName: user.display_name,
        teamName: user.metadata?.team_name || null,
        avatar: user.avatar,
      })),
      (q) =>
        q.onConflictDoUpdate({
          target: [schema.leagueUsers.leagueId, schema.leagueUsers.userId],
          set: {
            displayName: sql`excluded.display_name`,
            teamName: sql`excluded.team_name`,
            avatar: sql`excluded.avatar`,
          },
        })
    );
  }

  const db = getDb();
  await db
    .insert(schema.syncWatermarks)
    .values({ leagueId, dataType: USERS_WATERMARK_TYPE, lastWeek: 0 })
    .onConflictDoUpdate({
      target: [schema.syncWatermarks.leagueId, schema.syncWatermarks.dataType],
      set: { lastSyncedAt: new Date() },
    });
}

// Coalesces concurrent refreshes for the same league within a single server
// instance. Without this, 10 dashboard hits past the staleness threshold
// trigger 10 Sleeper requests + 10 racing upserts of identical data.
const inflightRefresh = new Map<string, Promise<void>>();

/**
 * Opportunistically refresh league_users for the given league when its cached
 * data is older than `thresholdMs`. Awaited inline so the route returns fresh
 * avatar hashes; the cost is one Sleeper request + a small upsert (~200ms),
 * paid at most once per threshold window per league.
 *
 * Sync errors are swallowed — a failed refresh must never break the page
 * render. The staleness check itself is not guarded; a DB outage there will
 * surface to the route, which is the right behavior since the route can't
 * function without DB anyway.
 */
export async function refreshLeagueUsersIfStale(
  leagueId: string,
  thresholdMs: number = STALE_USERS_MS
): Promise<void> {
  const db = getDb();
  const cutoff = Date.now() - thresholdMs;

  const [watermark, league] = await Promise.all([
    db
      .select({ lastSyncedAt: schema.syncWatermarks.lastSyncedAt })
      .from(schema.syncWatermarks)
      .where(
        and(
          eq(schema.syncWatermarks.leagueId, leagueId),
          eq(schema.syncWatermarks.dataType, USERS_WATERMARK_TYPE)
        )
      )
      .limit(1),
    db
      .select({ lastSyncedAt: schema.leagues.lastSyncedAt })
      .from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .limit(1),
  ]);

  const userMark = watermark[0]?.lastSyncedAt?.getTime() ?? 0;
  const fullMark = league[0]?.lastSyncedAt?.getTime() ?? 0;
  if (Math.max(userMark, fullMark) >= cutoff) return;

  const existing = inflightRefresh.get(leagueId);
  if (existing) return existing;

  const refresh = syncLeagueUsers(leagueId)
    .catch((err) =>
      console.warn(
        `[userSync] opportunistic refresh failed for ${leagueId}:`,
        err
      )
    )
    .finally(() => {
      inflightRefresh.delete(leagueId);
    });
  inflightRefresh.set(leagueId, refresh);
  return refresh;
}

/**
 * Convenience wrapper: refreshes the most recent league in a family. Callers
 * pass `members` straight from `league_family_members` without needing to
 * know the sort rule.
 */
export async function refreshFamilyAvatarsIfStale(
  members: Array<{ leagueId: string; season: string }>,
  thresholdMs?: number
): Promise<void> {
  if (members.length === 0) return;
  const mostRecent = members.reduce((a, b) =>
    parseInt(a.season, 10) >= parseInt(b.season, 10) ? a : b
  );
  await refreshLeagueUsersIfStale(mostRecent.leagueId, thresholdMs);
}
