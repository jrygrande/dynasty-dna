import { Sleeper } from "@/lib/sleeper";
import { getDb, getSyncDb, schema } from "@/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { syncPlayers } from "@/services/playerSync";
import { buildAssetEvents } from "@/services/assetEvents";
import { syncRosterStatus } from "@/services/rosterStatusSync";
import { syncInjuries } from "@/services/injurySync";
import { syncSchedule } from "@/services/scheduleSync";
import { syncFantasyCalcValues } from "@/services/fantasyCalcSync";
import { gradeLeagueTrades } from "@/services/tradeGrading";
import { gradeLeagueLineups } from "@/services/lineupGrading";
import { gradeLeagueDrafts } from "@/services/draftGrading";
import { rollupManagerGrades } from "@/services/managerGrades";
import { batchInsert, BATCH_SIZE } from "@/services/batchHelper";

interface SyncProgress {
  step: string;
  detail?: string;
}

type ProgressCallback = (progress: SyncProgress) => void;

/**
 * Read all sync watermarks for a league in a single query.
 * Returns a map of dataType → lastWeek.
 */
async function getWatermarks(
  leagueId: string
): Promise<Map<string, number>> {
  const db = getDb();
  const rows = await db
    .select({
      dataType: schema.syncWatermarks.dataType,
      lastWeek: schema.syncWatermarks.lastWeek,
    })
    .from(schema.syncWatermarks)
    .where(eq(schema.syncWatermarks.leagueId, leagueId));
  return new Map(rows.map((r) => [r.dataType, r.lastWeek]));
}

/**
 * Update the sync watermark after a successful sync.
 */
async function setWatermark(
  leagueId: string,
  dataType: string,
  lastWeek: number
): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.syncWatermarks)
    .values({ leagueId, dataType, lastWeek })
    .onConflictDoUpdate({
      target: [schema.syncWatermarks.leagueId, schema.syncWatermarks.dataType],
      set: { lastWeek, lastSyncedAt: new Date() },
    });
}

/**
 * Sync all data for a single league season from Sleeper.
 * skipGlobalSyncs: when true, skips players/nflverse/fantasyCalc (hoisted to family level).
 */
export async function syncLeague(
  leagueId: string,
  onProgress?: ProgressCallback,
  familyId?: string,
  opts?: { skipGlobalSyncs?: boolean }
): Promise<void> {
  const db = getDb();
  const skipGlobal = opts?.skipGlobalSyncs ?? false;

  // Ensure player metadata is available (skips if fresh)
  if (!skipGlobal) {
    onProgress?.({ step: "players", detail: "Checking player data freshness" });
    await syncPlayers();
  }

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

  // Sync users (bulk upsert)
  onProgress?.({ step: "users", detail: "Fetching league members" });
  const users = await Sleeper.getLeagueUsers(leagueId);
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

  // Sync rosters (bulk upsert)
  onProgress?.({ step: "rosters", detail: "Fetching rosters" });
  const rosters = await Sleeper.getRosters(leagueId);
  await batchInsert(
    schema.rosters,
    rosters.map((roster) => ({
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
    })),
    (q) =>
      q.onConflictDoUpdate({
        target: [schema.rosters.leagueId, schema.rosters.rosterId],
        set: {
          ownerId: sql`excluded.owner_id`,
          players: sql`excluded.players`,
          starters: sql`excluded.starters`,
          reserve: sql`excluded.reserve`,
          wins: sql`excluded.wins`,
          losses: sql`excluded.losses`,
          ties: sql`excluded.ties`,
          fpts: sql`excluded.fpts`,
          fptsAgainst: sql`excluded.fpts_against`,
          settings: sql`excluded.settings`,
        },
      })
  );

  // Sync drafts (bulk upsert)
  onProgress?.({ step: "drafts", detail: "Fetching draft data" });
  const drafts = await Sleeper.getDrafts(leagueId);

  await batchInsert(
    schema.drafts,
    drafts.map((draft) => ({
      id: draft.draft_id,
      leagueId,
      season: draft.season,
      type: draft.type,
      status: draft.status,
      startTime: draft.start_time,
      settings: draft.settings,
      slotToRosterId: draft.slot_to_roster_id,
    })),
    (q) =>
      q.onConflictDoUpdate({
        target: schema.drafts.id,
        set: {
          status: sql`excluded.status`,
          settings: sql`excluded.settings`,
          slotToRosterId: sql`excluded.slot_to_roster_id`,
        },
      })
  );

  // Sync draft picks (bulk per draft)
  for (const draft of drafts) {
    if (draft.status !== "complete") continue;
    const picks = await Sleeper.getDraftPicks(draft.draft_id);
    await batchInsert(
      schema.draftPicks,
      picks.map((pick) => ({
        draftId: draft.draft_id,
        pickNo: pick.pick_no,
        round: pick.round,
        rosterId: pick.roster_id,
        playerId: pick.player_id,
        isKeeper: pick.is_keeper || false,
        metadata: pick.metadata,
      })),
      (q) => q.onConflictDoNothing()
    );
  }

  // Sync traded picks (atomic delete + bulk insert in transaction)
  onProgress?.({ step: "traded_picks", detail: "Fetching traded picks" });
  const tradedPicks = await Sleeper.getTradedPicks(leagueId);
  const tradedPickValues = tradedPicks.map((tp) => ({
    leagueId,
    season: tp.season,
    round: tp.round,
    originalRosterId: tp.roster_id,
    currentOwnerId: tp.owner_id,
    previousOwnerId: tp.previous_owner_id,
  }));

  const syncDb = getSyncDb();
  await syncDb.transaction(async (tx) => {
    await tx
      .delete(schema.tradedPicks)
      .where(eq(schema.tradedPicks.leagueId, leagueId));
    for (let i = 0; i < tradedPickValues.length; i += BATCH_SIZE) {
      await tx
        .insert(schema.tradedPicks)
        .values(tradedPickValues.slice(i, i + BATCH_SIZE));
    }
  });

  // Read all watermarks for this league in one query
  const maxWeek = getMaxWeek(league.status);
  const watermarks = await getWatermarks(leagueId);

  // Sync transactions (incremental via watermark)
  onProgress?.({ step: "transactions", detail: "Fetching transactions" });
  const startTxWeek = (watermarks.get("transactions") ?? 0) + 1;
  const allTxValues: Array<typeof schema.transactions.$inferInsert> = [];

  for (let week = startTxWeek; week <= maxWeek; week++) {
    const txs = await Sleeper.getTransactions(leagueId, week);
    for (const tx of txs) {
      if (tx.status !== "complete") continue;
      allTxValues.push({
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
      });
    }
  }

  await batchInsert(schema.transactions, allTxValues, (q) =>
    q.onConflictDoNothing()
  );

  if (maxWeek > 0) {
    // For completed seasons, set watermark to maxWeek.
    // For in-progress, set to maxWeek - 1 so the latest week is re-fetched next time.
    const txWatermarkValue =
      league.status === "complete" ? maxWeek : Math.max(0, maxWeek - 1);
    await setWatermark(leagueId, "transactions", txWatermarkValue);
  }

  // Sync matchups + player scores (incremental via watermark, collected then batched)
  onProgress?.({ step: "matchups", detail: "Fetching matchups & scores" });
  const startMatchupWeek = (watermarks.get("matchups") ?? 0) + 1;
  const allMatchupValues: Array<typeof schema.matchups.$inferInsert> = [];
  const allScoreValues: Array<typeof schema.playerScores.$inferInsert> = [];

  for (let week = startMatchupWeek; week <= maxWeek; week++) {
    const matchups = await Sleeper.getMatchups(leagueId, week);
    if (!matchups || matchups.length === 0) continue;

    for (const m of matchups) {
      allMatchupValues.push({
        leagueId,
        week,
        rosterId: m.roster_id,
        matchupId: m.matchup_id,
        points: m.points || 0,
        starters: m.starters,
        starterPoints: m.starters_points,
        players: m.players,
        playerPoints: m.players_points,
      });

      // Extract individual player scores
      if (m.players_points) {
        const playerPoints =
          typeof m.players_points === "object" ? m.players_points : {};
        const starterSet = new Set(m.starters || []);

        for (const [playerId, points] of Object.entries(playerPoints)) {
          allScoreValues.push({
            leagueId,
            week,
            rosterId: m.roster_id,
            playerId,
            points: Number(points) || 0,
            isStarter: starterSet.has(playerId),
          });
        }
      }
    }
  }

  await batchInsert(schema.matchups, allMatchupValues, (q) =>
    q.onConflictDoUpdate({
      target: [
        schema.matchups.leagueId,
        schema.matchups.week,
        schema.matchups.rosterId,
      ],
      set: {
        matchupId: sql`excluded.matchup_id`,
        points: sql`excluded.points`,
        starters: sql`excluded.starters`,
        starterPoints: sql`excluded.starter_points`,
        players: sql`excluded.players`,
        playerPoints: sql`excluded.player_points`,
      },
    })
  );

  await batchInsert(schema.playerScores, allScoreValues, (q) =>
    q.onConflictDoNothing()
  );

  if (maxWeek > 0) {
    const matchupWatermarkValue =
      league.status === "complete" ? maxWeek : Math.max(0, maxWeek - 1);
    await setWatermark(leagueId, "matchups", matchupWatermarkValue);
  }

  // Sync winners bracket (only when playoffs have started)
  const playoffStart = (league.settings as Record<string, unknown>)?.playoff_week_start as number | undefined;
  if (playoffStart && maxWeek >= playoffStart) {
    try {
      const bracket = await Sleeper.getWinnersBracket(leagueId);
      if (bracket?.length > 0 && bracket.some((m) => m.w !== null)) {
        await db.update(schema.leagues)
          .set({ winnersBracket: bracket })
          .where(eq(schema.leagues.id, leagueId));
      }
    } catch (err) {
      console.warn(`[sync] Winners bracket fetch failed for ${leagueId}:`, err);
    }
  }

  // Build asset events from transactions + drafts
  onProgress?.({
    step: "asset_events",
    detail: "Building asset event timeline",
  });
  await buildAssetEvents(leagueId, league.season);

  // Sync NFL data (only when not hoisted to family level)
  if (!skipGlobal) {
    const seasonYear = parseInt(league.season, 10);
    if (!isNaN(seasonYear)) {
      let seasons = [seasonYear];
      if (familyId) {
        const members = await db
          .select({ season: schema.leagueFamilyMembers.season })
          .from(schema.leagueFamilyMembers)
          .where(eq(schema.leagueFamilyMembers.familyId, familyId));
        const familySeasons = members
          .map((m) => parseInt(m.season, 10))
          .filter((s) => !isNaN(s));
        if (familySeasons.length > 0) {
          seasons = [...new Set(familySeasons)];
        }
      }
      onProgress?.({
        step: "nfl_data",
        detail: `Syncing NFL roster status, injuries & schedule (${seasons.length} seasons)`,
      });
      await syncRosterStatus({ seasons });
      await syncInjuries({ seasons });
      await syncSchedule({ seasons });
    }

    // Sync FantasyCalc dynasty trade values
    onProgress?.({ step: "values", detail: "Syncing dynasty trade values" });
    await syncFantasyCalcValues(leagueId);
  }

  // Grade trades + drafts (requires familyId)
  if (familyId) {
    onProgress?.({ step: "trade_grades", detail: "Grading trades" });
    try {
      await gradeLeagueTrades(leagueId, familyId);
    } catch (err) {
      console.warn(`[sync] Trade grading failed for ${leagueId}:`, err);
    }

    onProgress?.({ step: "draft_grades", detail: "Grading draft picks" });
    try {
      await gradeLeagueDrafts(leagueId, familyId);
    } catch (err) {
      console.warn(`[sync] Draft grading failed for ${leagueId}:`, err);
    }
  }

  // Grade lineups (non-critical)
  onProgress?.({ step: "lineup_grades", detail: "Grading lineups" });
  try {
    await gradeLeagueLineups(leagueId);
  } catch (err) {
    console.warn(`[sync] Lineup grading failed for ${leagueId}:`, err);
  }

  onProgress?.({ step: "complete", detail: "Sync complete" });
}

function getMaxWeek(status: string): number {
  if (status === "complete") return 18;
  if (status === "in_season") return 18;
  return 0;
}

const COMPLETED_STALENESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const PARALLEL_CONCURRENCY = 3;

/**
 * Sync the entire league family (all seasons).
 * Hoists shared syncs (players, nflverse, fantasyCalc) to run once.
 * Skips completed seasons synced within the last 7 days.
 * Parallelizes completed season syncs (up to 3 concurrent).
 */
export async function syncLeagueFamily(
  leagueIds: string[],
  onProgress?: ProgressCallback,
  familyId?: string
): Promise<void> {
  const db = getDb();

  // --- Hoisted global syncs: run once for the whole family ---
  onProgress?.({ step: "players", detail: "Checking player data freshness" });
  await syncPlayers();

  // Gather all family seasons for nflverse sync
  const familySeasons: number[] = [];
  if (familyId) {
    const members = await db
      .select({ season: schema.leagueFamilyMembers.season })
      .from(schema.leagueFamilyMembers)
      .where(eq(schema.leagueFamilyMembers.familyId, familyId));
    for (const m of members) {
      const s = parseInt(m.season, 10);
      if (!isNaN(s)) familySeasons.push(s);
    }
  }

  const uniqueSeasons = [...new Set(familySeasons)];
  if (uniqueSeasons.length > 0) {
    onProgress?.({
      step: "nfl_data",
      detail: `Syncing NFL data (${uniqueSeasons.length} seasons)`,
    });
    await syncRosterStatus({ seasons: uniqueSeasons });
    await syncInjuries({ seasons: uniqueSeasons });
    await syncSchedule({ seasons: uniqueSeasons });
  }

  // FantasyCalc: sync once using the most recent league's settings
  const mostRecentLeagueId = leagueIds[leagueIds.length - 1];
  onProgress?.({ step: "values", detail: "Syncing dynasty trade values" });
  await syncFantasyCalcValues(mostRecentLeagueId);

  // --- Partition into completed (parallelizable) vs in-progress (sequential) ---
  // Single batched query instead of N individual queries
  const leagueStatuses = await db
    .select({
      id: schema.leagues.id,
      status: schema.leagues.status,
      lastSyncedAt: schema.leagues.lastSyncedAt,
    })
    .from(schema.leagues)
    .where(inArray(schema.leagues.id, leagueIds));

  const statusMap = new Map(leagueStatuses.map((l) => [l.id, l]));

  const completedIds: string[] = [];
  const activeIds: string[] = [];
  const skipIds: string[] = [];

  for (const leagueId of leagueIds) {
    const existing = statusMap.get(leagueId);
    if (existing) {
      const { status, lastSyncedAt } = existing;
      if (
        status === "complete" &&
        lastSyncedAt &&
        Date.now() - new Date(lastSyncedAt).getTime() < COMPLETED_STALENESS_MS
      ) {
        skipIds.push(leagueId);
        continue;
      }
      if (status === "complete") {
        completedIds.push(leagueId);
      } else {
        activeIds.push(leagueId);
      }
    } else {
      activeIds.push(leagueId);
    }
  }

  // Sync skipped seasons notification
  if (skipIds.length > 0) {
    onProgress?.({
      step: "family",
      detail: `Skipping ${skipIds.length} recently-synced season(s)`,
    });
  }

  // Process completed seasons in parallel (concurrency limited)
  if (completedIds.length > 0) {
    onProgress?.({
      step: "family",
      detail: `Syncing ${completedIds.length} completed season(s)`,
    });
    for (let i = 0; i < completedIds.length; i += PARALLEL_CONCURRENCY) {
      const batch = completedIds.slice(i, i + PARALLEL_CONCURRENCY);
      await Promise.all(
        batch.map((id) =>
          syncLeague(id, undefined, familyId, { skipGlobalSyncs: true })
        )
      );
    }
  }

  // Process active seasons sequentially
  for (let i = 0; i < activeIds.length; i++) {
    onProgress?.({
      step: "family",
      detail: `Syncing active season ${i + 1} of ${activeIds.length}`,
    });
    await syncLeague(activeIds[i], onProgress, familyId, {
      skipGlobalSyncs: true,
    });
  }

  // Roll up all_time + overall_score after all per-league grading is done
  if (familyId) {
    onProgress?.({
      step: "manager_grades",
      detail: "Computing career manager grades",
    });
    try {
      await rollupManagerGrades(familyId);
    } catch (err) {
      console.warn(
        `[sync] Manager grade rollup failed for family ${familyId}:`,
        err
      );
    }
  }
}
