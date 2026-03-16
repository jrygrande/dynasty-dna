import { Sleeper } from "@/lib/sleeper";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { syncPlayers } from "@/services/playerSync";
import { buildAssetEvents } from "@/services/assetEvents";
import { syncRosterStatus } from "@/services/rosterStatusSync";
import { syncInjuries } from "@/services/injurySync";
import { syncSchedule } from "@/services/scheduleSync";

interface SyncProgress {
  step: string;
  detail?: string;
}

type ProgressCallback = (progress: SyncProgress) => void;

/**
 * Sync all data for a single league season from Sleeper.
 */
export async function syncLeague(
  leagueId: string,
  onProgress?: ProgressCallback
): Promise<void> {
  const db = getDb();

  // Ensure player metadata is available (skips if fresh)
  onProgress?.({ step: "players", detail: "Checking player data freshness" });
  await syncPlayers();

  onProgress?.({ step: "league", detail: "Fetching league info" });
  const league = await Sleeper.getLeague(leagueId);

  // Upsert league
  await db
    .insert(schema.leagues)
    .values({
      id: league.league_id,
      name: league.name,
      season: league.season,
      previousLeagueId: league.previous_league_id,
      status: league.status,
      settings: league.settings,
      scoringSettings: league.scoring_settings,
      rosterPositions: league.roster_positions,
      totalRosters: league.total_rosters,
    })
    .onConflictDoUpdate({
      target: schema.leagues.id,
      set: {
        name: league.name,
        status: league.status,
        settings: league.settings,
        scoringSettings: league.scoring_settings,
        rosterPositions: league.roster_positions,
        totalRosters: league.total_rosters,
        lastSyncedAt: new Date(),
      },
    });

  // Sync users
  onProgress?.({ step: "users", detail: "Fetching league members" });
  const users = await Sleeper.getLeagueUsers(leagueId);
  for (const user of users) {
    await db
      .insert(schema.leagueUsers)
      .values({
        leagueId,
        userId: user.user_id,
        displayName: user.display_name,
        teamName: user.metadata?.team_name || null,
        avatar: user.avatar,
      })
      .onConflictDoUpdate({
        target: [schema.leagueUsers.leagueId, schema.leagueUsers.userId],
        set: {
          displayName: user.display_name,
          teamName: user.metadata?.team_name || null,
          avatar: user.avatar,
        },
      });
  }

  // Sync rosters
  onProgress?.({ step: "rosters", detail: "Fetching rosters" });
  const rosters = await Sleeper.getRosters(leagueId);
  for (const roster of rosters) {
    await db
      .insert(schema.rosters)
      .values({
        leagueId,
        rosterId: roster.roster_id,
        ownerId: roster.owner_id,
        players: roster.players,
        starters: roster.starters,
        reserve: roster.reserve,
        wins: roster.settings?.wins || 0,
        losses: roster.settings?.losses || 0,
        ties: roster.settings?.ties || 0,
        fpts:
          (roster.settings?.fpts || 0) +
          (roster.settings?.fpts_decimal || 0) / 100,
        fptsAgainst:
          (roster.settings?.fpts_against || 0) +
          (roster.settings?.fpts_against_decimal || 0) / 100,
        settings: roster.settings,
      })
      .onConflictDoUpdate({
        target: [schema.rosters.leagueId, schema.rosters.rosterId],
        set: {
          ownerId: roster.owner_id,
          players: roster.players,
          starters: roster.starters,
          reserve: roster.reserve,
          wins: roster.settings?.wins || 0,
          losses: roster.settings?.losses || 0,
          ties: roster.settings?.ties || 0,
          fpts:
            (roster.settings?.fpts || 0) +
            (roster.settings?.fpts_decimal || 0) / 100,
          fptsAgainst:
            (roster.settings?.fpts_against || 0) +
            (roster.settings?.fpts_against_decimal || 0) / 100,
          settings: roster.settings,
        },
      });
  }

  // Sync drafts
  onProgress?.({ step: "drafts", detail: "Fetching draft data" });
  const drafts = await Sleeper.getDrafts(leagueId);
  for (const draft of drafts) {
    await db
      .insert(schema.drafts)
      .values({
        id: draft.draft_id,
        leagueId,
        season: draft.season,
        type: draft.type,
        status: draft.status,
        startTime: draft.start_time,
        settings: draft.settings,
      })
      .onConflictDoUpdate({
        target: schema.drafts.id,
        set: {
          status: draft.status,
          settings: draft.settings,
        },
      });

    if (draft.status === "complete") {
      const picks = await Sleeper.getDraftPicks(draft.draft_id);
      for (const pick of picks) {
        await db
          .insert(schema.draftPicks)
          .values({
            draftId: draft.draft_id,
            pickNo: pick.pick_no,
            round: pick.round,
            rosterId: pick.roster_id,
            playerId: pick.player_id,
            isKeeper: pick.is_keeper || false,
            metadata: pick.metadata,
          })
          .onConflictDoNothing();
      }
    }
  }

  // Sync traded picks
  onProgress?.({ step: "traded_picks", detail: "Fetching traded picks" });
  const tradedPicks = await Sleeper.getTradedPicks(leagueId);
  // Delete existing and re-insert
  await db
    .delete(schema.tradedPicks)
    .where(eq(schema.tradedPicks.leagueId, leagueId));
  for (const tp of tradedPicks) {
    await db.insert(schema.tradedPicks).values({
      leagueId,
      season: tp.season,
      round: tp.round,
      originalRosterId: tp.roster_id,
      currentOwnerId: tp.owner_id,
      previousOwnerId: tp.previous_owner_id,
    });
  }

  // Sync transactions (all weeks)
  onProgress?.({ step: "transactions", detail: "Fetching transactions" });
  const maxWeek = getMaxWeek(league.status);
  for (let week = 1; week <= maxWeek; week++) {
    const txs = await Sleeper.getTransactions(leagueId, week);
    for (const tx of txs) {
      if (tx.status !== "complete") continue;
      await db
        .insert(schema.transactions)
        .values({
          id: tx.transaction_id,
          leagueId,
          type: tx.type,
          status: tx.status,
          week: tx.leg,
          rosterIds: tx.roster_ids,
          adds: tx.adds,
          drops: tx.drops,
          draftPicks: tx.draft_picks,
          settings: tx.settings,
          createdAt: tx.created,
        })
        .onConflictDoNothing();
    }
  }

  // Sync matchups (all weeks)
  onProgress?.({ step: "matchups", detail: "Fetching matchups & scores" });
  for (let week = 1; week <= maxWeek; week++) {
    const matchups = await Sleeper.getMatchups(leagueId, week);
    if (!matchups || matchups.length === 0) continue;

    for (const m of matchups) {
      await db
        .insert(schema.matchups)
        .values({
          leagueId,
          week,
          rosterId: m.roster_id,
          matchupId: m.matchup_id,
          points: m.points || 0,
          starters: m.starters,
          starterPoints: m.starters_points,
          players: m.players,
          playerPoints: m.players_points,
        })
        .onConflictDoUpdate({
          target: [
            schema.matchups.leagueId,
            schema.matchups.week,
            schema.matchups.rosterId,
          ],
          set: {
            matchupId: m.matchup_id,
            points: m.points || 0,
            starters: m.starters,
            starterPoints: m.starters_points,
            players: m.players,
            playerPoints: m.players_points,
          },
        });

      // Extract individual player scores from matchup data
      if (m.players_points) {
        const playerPoints =
          typeof m.players_points === "object" ? m.players_points : {};
        const starterSet = new Set(m.starters || []);

        for (const [playerId, points] of Object.entries(playerPoints)) {
          await db
            .insert(schema.playerScores)
            .values({
              leagueId,
              week,
              rosterId: m.roster_id,
              playerId,
              points: Number(points) || 0,
              isStarter: starterSet.has(playerId),
            })
            .onConflictDoNothing();
        }
      }
    }
  }

  // Build asset events from transactions + drafts
  onProgress?.({ step: "asset_events", detail: "Building asset event timeline" });
  await buildAssetEvents(leagueId, league.season);

  // Sync NFL roster status + injury data for this season (skips if already synced)
  const seasonYear = parseInt(league.season, 10);
  if (!isNaN(seasonYear)) {
    onProgress?.({ step: "nfl_data", detail: "Syncing NFL roster status, injuries & schedule" });
    await syncRosterStatus({ seasons: [seasonYear] });
    await syncInjuries({ seasons: [seasonYear] });
    await syncSchedule({ seasons: [seasonYear] });
  }

  onProgress?.({ step: "complete", detail: "Sync complete" });
}

function getMaxWeek(status: string): number {
  // For complete seasons, check all 18 weeks (17 game + 1 bye structure)
  // For in-progress seasons, we'll check up to 18 and stop when empty
  if (status === "complete") return 18;
  if (status === "in_season") return 18;
  return 0; // pre_draft or drafting — no matchups yet
}

const COMPLETED_STALENESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for completed seasons

/**
 * Sync the entire league family (all seasons).
 * Skips completed seasons that were synced within the last 7 days.
 */
export async function syncLeagueFamily(
  leagueIds: string[],
  onProgress?: ProgressCallback
): Promise<void> {
  const db = getDb();

  for (let i = 0; i < leagueIds.length; i++) {
    const leagueId = leagueIds[i];
    onProgress?.({
      step: "family",
      detail: `Syncing season ${i + 1} of ${leagueIds.length}`,
    });

    // Check if we can skip this league (completed + recently synced)
    const existing = await db
      .select({
        status: schema.leagues.status,
        lastSyncedAt: schema.leagues.lastSyncedAt,
      })
      .from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .limit(1);

    if (existing.length > 0) {
      const { status, lastSyncedAt } = existing[0];
      if (
        status === "complete" &&
        lastSyncedAt &&
        Date.now() - new Date(lastSyncedAt).getTime() < COMPLETED_STALENESS_MS
      ) {
        onProgress?.({
          step: "family",
          detail: `Season ${i + 1} of ${leagueIds.length} — skipped (recently synced)`,
        });
        continue;
      }
    }

    await syncLeague(leagueId, onProgress);
  }
}
