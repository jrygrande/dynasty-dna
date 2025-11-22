import { pgTable, text, integer, timestamp, jsonb, uuid, boolean, numeric, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';

// Postgres schema aligned with ensureSchema() and Neon driver.

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(), // Sleeper user_id
    username: text('username').notNull(),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => ({
    usernameIdx: uniqueIndex('users_username_uq').on(t.username),
  })
);

export const leagues = pgTable(
  'leagues',
  {
    id: text('id').primaryKey(), // Sleeper league_id
    name: text('name').notNull(),
    season: text('season').notNull(),
    previousLeagueId: text('previous_league_id'),
    settings: jsonb('settings'),
    lastAssetEventsSyncAt: timestamp('last_asset_events_sync_at', { withTimezone: false }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: false }),
    syncStartedAt: timestamp('sync_started_at', { withTimezone: false }),
    syncStatus: text('sync_status', { enum: ['idle', 'syncing', 'failed'] }).default('idle'),
    syncVersion: integer('sync_version').default(1),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => ({
    prevIdx: index('leagues_previous_league_id_idx').on(t.previousLeagueId),
    seasonIdx: index('leagues_season_idx').on(t.season),
    syncStatusIdx: index('leagues_sync_status_idx').on(t.syncStatus),
  })
);

export const rosters = pgTable(
  'rosters',
  {
    rosterId: integer('roster_id').notNull(), // Sleeper roster_id (per league)
    leagueId: text('league_id').notNull(),
    ownerId: text('owner_id').notNull(), // users.id
  },
  (t) => ({
    pk: primaryKey({ columns: [t.leagueId, t.rosterId], name: 'rosters_pk' }),
    leagueIdx: index('rosters_league_id_idx').on(t.leagueId),
    ownerIdx: index('rosters_owner_id_idx').on(t.ownerId),
  })
);

export const players = pgTable('players', {
  id: text('id').primaryKey(), // Sleeper player_id
  name: text('name').notNull(),
  position: text('position'),
  team: text('team'),
  status: text('status'),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});

export const transactions = pgTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    leagueId: text('league_id').notNull(),
    week: integer('week'),
    type: text('type').notNull(), // trade|waiver|free_agent|commissioner
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => ({
    leagueWeekIdx: index('transactions_league_week_idx').on(t.leagueId, t.week),
    typeIdx: index('transactions_type_idx').on(t.type),
  })
);

export const nflState = pgTable('nfl_state', {
  id: text('id').primaryKey(), // constant 'nfl'
  season: text('season').notNull(),
  week: integer('week').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: false }).defaultNow().notNull(),
});

export const nflSeasons = pgTable('nfl_seasons', {
  season: text('season').primaryKey(),
  maxWeek: integer('max_week').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});

export const metricSnapshots = pgTable(
  'metric_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leagueId: text('league_id').notNull(),
    managerId: text('manager_id').notNull(),
    scope: text('scope').notNull(), // week:2024-03 or season:2024
    metric: text('metric').notNull(),
    value: numeric('value', { precision: 12, scale: 4 }).notNull(),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => ({
    leagueManagerMetricScopeIdx: uniqueIndex('metric_snapshots_unique').on(
      t.leagueId,
      t.managerId,
      t.metric,
      t.scope,
    ),
  })
);

export const matchups = pgTable(
  'matchups',
  {
    leagueId: text('league_id').notNull(),
    week: integer('week').notNull(),
    rosterId: integer('roster_id').notNull(),
    starters: jsonb('starters'),
    players: jsonb('players'),
    points: numeric('points', { precision: 10, scale: 2 }).notNull().default('0'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.leagueId, t.week, t.rosterId], name: 'matchups_pk' }),
    leagueWeekIdx: index('matchups_league_week_idx').on(t.leagueId, t.week),
  })
);

export const drafts = pgTable(
  'drafts',
  {
    id: text('id').primaryKey(),
    leagueId: text('league_id').notNull(),
    season: text('season').notNull(),
    startTime: timestamp('start_time', { withTimezone: false }),
    settings: jsonb('settings'),
  },
  (t) => ({
    leagueIdx: index('drafts_league_idx').on(t.leagueId),
  })
);

export const draftPicks = pgTable(
  'draft_picks',
  {
    draftId: text('draft_id').notNull(),
    pickNo: integer('pick_no').notNull(),
    round: integer('round').notNull(),
    rosterId: integer('roster_id'),
    playerId: text('player_id'),
    isKeeper: boolean('is_keeper').default(false),
    tradedFromRosterId: integer('traded_from_roster_id'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.draftId, t.pickNo], name: 'draft_picks_pk' }),
    roundIdx: index('draft_picks_round_idx').on(t.draftId, t.round),
    playerIdx: index('draft_picks_player_idx').on(t.playerId),
  })
);

export const tradedPicks = pgTable(
  'traded_picks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leagueId: text('league_id').notNull(),
    season: text('season').notNull(),
    round: integer('round').notNull(),
    originalRosterId: integer('original_roster_id').notNull(),
    currentOwnerId: text('current_owner_id').notNull(), // users.id
  },
  (t) => ({
    leagueSeasonIdx: index('traded_picks_league_season_idx').on(t.leagueId, t.season),
  })
);

// Normalized events for asset timelines (players and future picks)
export const playerScores = pgTable(
  'player_scores',
  {
    leagueId: text('league_id').notNull(),
    week: integer('week').notNull(),
    rosterId: integer('roster_id').notNull(),
    playerId: text('player_id').notNull(),
    points: numeric('points', { precision: 10, scale: 2 }).notNull().default('0'),
    isStarter: boolean('is_starter').notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.leagueId, t.week, t.rosterId, t.playerId], name: 'player_scores_pk' }),
    leagueWeekIdx: index('player_scores_league_week_idx').on(t.leagueId, t.week),
    playerIdx: index('player_scores_player_idx').on(t.playerId),
  })
);

export const assetEvents = pgTable(
  'asset_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leagueId: text('league_id').notNull(),
    season: text('season'),
    week: integer('week'),
    eventTime: timestamp('event_time', { withTimezone: false }),
    eventType: text('event_type').notNull(), // draft_selected|trade|waiver_add|waiver_drop|free_agent_add|free_agent_drop|commissioner|pick_trade|pick_selected
    // Asset identity
    assetKind: text('asset_kind').notNull(), // player|pick
    playerId: text('player_id'),
    pickSeason: text('pick_season'),
    pickRound: integer('pick_round'),
    pickOriginalRosterId: integer('pick_original_roster_id'),
    // Ownership movement
    fromUserId: text('from_user_id'),
    toUserId: text('to_user_id'),
    fromRosterId: integer('from_roster_id'),
    toRosterId: integer('to_roster_id'),
    // Links
    transactionId: text('transaction_id'),
    details: jsonb('details'),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => ({
    leagueIdx: index('asset_events_league_idx').on(t.leagueId),
    playerIdx: index('asset_events_player_idx').on(t.assetKind, t.playerId),
    pickIdx: index('asset_events_pick_idx').on(t.assetKind, t.pickSeason, t.pickRound, t.pickOriginalRosterId),
    timeIdx: index('asset_events_time_idx').on(t.season, t.week, t.eventTime),
  })
);

export const enrichedTransactions = pgTable(
  'enriched_transactions',
  {
    id: text('id').primaryKey(), // Sleeper transaction ID or synthetic draft-pick ID
    leagueId: text('league_id').notNull(),
    type: text('type').notNull(), // trade, waiver, free_agent, draft_selection
    status: text('status').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: false }).notNull(),

    // The managers involved
    managers: jsonb('managers').$type<{
      rosterId: number;
      userId: string;
      displayName: string;
      side: 'proposer' | 'consenter' | 'selector' | null;
    }[]>(),

    // All assets moving in this transaction, fully resolved
    assets: jsonb('assets').$type<{
      kind: 'player' | 'pick';
      id: string; // player_id or pick_id
      name: string; // Resolved name (Player Name or "2024 1st Rd")
      fromRosterId: number | null;
      toRosterId: number | null;
      fromUserId: string | null;
      toUserId: string | null;
    }[]>(),

    metadata: jsonb('metadata'), // Any extra context
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => ({
    leagueIdx: index('enriched_transactions_league_idx').on(t.leagueId),
    typeIdx: index('enriched_transactions_type_idx').on(t.type),
    timeIdx: index('enriched_transactions_timestamp_idx').on(t.timestamp),
  })
);

export const jobRuns = pgTable('job_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: text('type').notNull(),
  ref: text('ref'),
  status: text('status').default('running').notNull(),
  total: integer('total'),
  done: integer('done').default(0),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: false }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: false }),
}, (t) => ({
  typeRefIdx: index('job_runs_type_ref_idx').on(t.type, t.ref),
  startedIdx: index('job_runs_started_idx').on(t.startedAt),
}));

