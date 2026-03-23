import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  boolean,
  real,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";

// ============================================================
// NextAuth.js Tables
// ============================================================

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    pk: primaryKey({ columns: [account.provider, account.providerAccountId] }),
  })
);

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    pk: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);

// ============================================================
// Sleeper Account Linking
// ============================================================

export const sleeperLinks = pgTable(
  "sleeper_links",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sleeperId: text("sleeper_id").notNull(),
    sleeperUsername: text("sleeper_username").notNull(),
    linkedAt: timestamp("linked_at", { mode: "date" }).defaultNow().notNull(),
  },
  (sl) => ({
    pk: primaryKey({ columns: [sl.userId] }),
    sleeperIdIdx: uniqueIndex("sleeper_links_sleeper_id_idx").on(sl.sleeperId),
  })
);

// ============================================================
// League & Roster Data (cached from Sleeper)
// ============================================================

export const leagues = pgTable("leagues", {
  id: text("id").primaryKey(), // Sleeper league_id
  name: text("name").notNull(),
  season: text("season").notNull(),
  previousLeagueId: text("previous_league_id"),
  status: text("status"), // pre_draft, drafting, in_season, complete
  settings: jsonb("settings"),
  scoringSettings: jsonb("scoring_settings"),
  rosterPositions: jsonb("roster_positions"), // e.g. ["QB","RB","RB","WR","WR","TE","FLEX","FLEX","BN",...]
  totalRosters: integer("total_rosters"),
  winnersBracket: jsonb("winners_bracket"), // Sleeper playoff winners bracket data
  lastSyncedAt: timestamp("last_synced_at", { mode: "date" }),
});

export const leagueFamilies = pgTable(
  "league_families",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rootLeagueId: text("root_league_id").notNull(), // The most recent league in the chain
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (lf) => ({
    rootLeagueUnique: uniqueIndex("league_families_root_league_id_unique").on(
      lf.rootLeagueId
    ),
  })
);

export const leagueFamilyMembers = pgTable(
  "league_family_members",
  {
    familyId: uuid("family_id")
      .notNull()
      .references(() => leagueFamilies.id, { onDelete: "cascade" }),
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    season: text("season").notNull(),
  },
  (lfm) => ({
    pk: primaryKey({ columns: [lfm.familyId, lfm.leagueId] }),
  })
);

export const leagueUsers = pgTable(
  "league_users",
  {
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(), // Sleeper user_id
    displayName: text("display_name"),
    teamName: text("team_name"),
    avatar: text("avatar"),
  },
  (lu) => ({
    pk: primaryKey({ columns: [lu.leagueId, lu.userId] }),
  })
);

export const rosters = pgTable(
  "rosters",
  {
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    rosterId: integer("roster_id").notNull(),
    ownerId: text("owner_id"), // Sleeper user_id
    players: jsonb("players"), // string[] of player IDs
    starters: jsonb("starters"), // string[] of starter player IDs
    reserve: jsonb("reserve"), // IR slots
    wins: integer("wins").default(0),
    losses: integer("losses").default(0),
    ties: integer("ties").default(0),
    fpts: real("fpts").default(0),
    fptsAgainst: real("fpts_against").default(0),
    settings: jsonb("settings"),
  },
  (r) => ({
    pk: primaryKey({ columns: [r.leagueId, r.rosterId] }),
    ownerIdx: index("rosters_owner_idx").on(r.leagueId, r.ownerId),
  })
);

// ============================================================
// Player Data
// ============================================================

export const players = pgTable("players", {
  id: text("id").primaryKey(), // Sleeper player_id
  gsisId: text("gsis_id"), // NFL GSIS ID — join key for nflverse data
  name: text("name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  position: text("position"), // QB, RB, WR, TE, K, DEF
  team: text("team"), // NFL team abbreviation
  age: integer("age"),
  status: text("status"), // Active, Inactive, Injured Reserve
  injuryStatus: text("injury_status"), // Out, Doubtful, Questionable, null
  yearsExp: integer("years_exp"),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// ============================================================
// Transaction & Event Data
// ============================================================

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(), // Sleeper transaction_id
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // trade, waiver, free_agent, commissioner
    status: text("status").notNull(), // complete, failed
    week: integer("week").notNull(),
    rosterIds: jsonb("roster_ids"), // number[]
    adds: jsonb("adds"), // { playerId: rosterId }
    drops: jsonb("drops"), // { playerId: rosterId }
    draftPicks: jsonb("draft_picks"), // traded draft picks in this transaction
    settings: jsonb("settings"), // waiver bid amount, etc
    createdAt: bigint("created_at", { mode: "number" }), // Sleeper timestamp (ms)
  },
  (t) => ({
    leagueWeekIdx: index("transactions_league_week_idx").on(
      t.leagueId,
      t.week
    ),
  })
);

export const assetEvents = pgTable(
  "asset_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: text("league_id").notNull(),
    season: text("season").notNull(),
    week: integer("week").notNull(),
    eventType: text("event_type").notNull(), // draft_selected, trade, waiver_add, waiver_drop, free_agent_add, free_agent_drop, commissioner, pick_trade
    assetKind: text("asset_kind").notNull(), // player | pick
    // Player fields
    playerId: text("player_id"),
    // Pick fields
    pickSeason: text("pick_season"),
    pickRound: integer("pick_round"),
    pickOriginalRosterId: integer("pick_original_roster_id"),
    // Movement
    fromRosterId: integer("from_roster_id"),
    toRosterId: integer("to_roster_id"),
    fromUserId: text("from_user_id"),
    toUserId: text("to_user_id"),
    transactionId: text("transaction_id"),
    details: jsonb("details"),
    createdAt: bigint("created_at", { mode: "number" }),
  },
  (ae) => ({
    playerIdx: index("asset_events_player_idx").on(ae.leagueId, ae.playerId),
    txIdx: index("asset_events_tx_idx").on(ae.transactionId),
    pickIdx: index("asset_events_pick_idx").on(
      ae.leagueId,
      ae.pickSeason,
      ae.pickRound,
      ae.pickOriginalRosterId
    ),
  })
);

// ============================================================
// Draft Data
// ============================================================

export const drafts = pgTable("drafts", {
  id: text("id").primaryKey(), // Sleeper draft_id
  leagueId: text("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: "cascade" }),
  season: text("season").notNull(),
  type: text("type"), // snake, auction, linear
  status: text("status"), // pre_draft, drafting, complete
  startTime: bigint("start_time", { mode: "number" }),
  settings: jsonb("settings"),
  slotToRosterId: jsonb("slot_to_roster_id"), // { slot: rosterId }
});

export const draftPicks = pgTable(
  "draft_picks",
  {
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    pickNo: integer("pick_no").notNull(),
    round: integer("round").notNull(),
    rosterId: integer("roster_id").notNull(),
    playerId: text("player_id"),
    isKeeper: boolean("is_keeper").default(false),
    metadata: jsonb("metadata"),
  },
  (dp) => ({
    pk: primaryKey({ columns: [dp.draftId, dp.pickNo] }),
  })
);

export const tradedPicks = pgTable(
  "traded_picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    season: text("season").notNull(),
    round: integer("round").notNull(),
    originalRosterId: integer("original_roster_id").notNull(),
    currentOwnerId: integer("current_owner_id").notNull(),
    previousOwnerId: integer("previous_owner_id"),
  },
  (tp) => ({
    leagueSeasonIdx: index("traded_picks_league_season_idx").on(
      tp.leagueId,
      tp.season
    ),
  })
);

// ============================================================
// Scoring Data
// ============================================================

export const playerScores = pgTable(
  "player_scores",
  {
    leagueId: text("league_id").notNull(),
    week: integer("week").notNull(),
    rosterId: integer("roster_id").notNull(),
    playerId: text("player_id").notNull(),
    points: real("points").default(0),
    isStarter: boolean("is_starter").default(false),
  },
  (ps) => ({
    pk: primaryKey({
      columns: [ps.leagueId, ps.week, ps.rosterId, ps.playerId],
    }),
  })
);

export const matchups = pgTable(
  "matchups",
  {
    leagueId: text("league_id").notNull(),
    week: integer("week").notNull(),
    rosterId: integer("roster_id").notNull(),
    matchupId: integer("matchup_id"),
    points: real("points").default(0),
    starters: jsonb("starters"), // string[]
    starterPoints: jsonb("starter_points"), // number[]
    players: jsonb("players"), // string[]
    playerPoints: jsonb("player_points"), // { playerId: points }
  },
  (m) => ({
    pk: primaryKey({ columns: [m.leagueId, m.week, m.rosterId] }),
  })
);

// ============================================================
// NFL Reference Data
// ============================================================

export const nflState = pgTable("nfl_state", {
  id: text("id").primaryKey().default("nfl"), // singleton
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  seasonType: text("season_type"), // pre, regular, post
  fetchedAt: timestamp("fetched_at", { mode: "date" }).defaultNow().notNull(),
});

export const nflSchedule = pgTable(
  "nfl_schedule",
  {
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    gameDate: text("game_date"), // YYYY-MM-DD
  },
  (ns) => ({
    pk: primaryKey({ columns: [ns.season, ns.week, ns.homeTeam] }),
  })
);

export const nflInjuries = pgTable(
  "nfl_injuries",
  {
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    gsisId: text("gsis_id").notNull(), // NFL GSIS ID — join key to players table
    gameType: text("game_type"), // REG, POST
    playerName: text("player_name"),
    team: text("team"),
    position: text("position"),
    reportStatus: text("report_status"), // Out, Doubtful, Questionable
    reportPrimaryInjury: text("report_primary_injury"), // Knee, Ankle, Concussion, etc.
    reportSecondaryInjury: text("report_secondary_injury"),
    practiceStatus: text("practice_status"), // Did Not Participate, Limited, Full
    practicePrimaryInjury: text("practice_primary_injury"),
    practiceSecondaryInjury: text("practice_secondary_injury"),
    dateModified: text("date_modified"),
  },
  (ni) => ({
    pk: primaryKey({ columns: [ni.season, ni.week, ni.gsisId] }),
    gsisIdx: index("nfl_injuries_gsis_idx").on(ni.gsisId),
  })
);

export const nflWeeklyRosterStatus = pgTable(
  "nfl_weekly_roster_status",
  {
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    gsisId: text("gsis_id").notNull(),
    status: text("status").notNull(), // ACT, RES, INA, DEV, CUT, etc.
    statusAbbr: text("status_abbr"), // A01, R01, R48, P03, etc.
    team: text("team"),
    position: text("position"),
    playerName: text("player_name"),
  },
  (rs) => ({
    pk: primaryKey({ columns: [rs.season, rs.week, rs.gsisId] }),
    gsisIdx: index("nfl_roster_status_gsis_idx").on(rs.gsisId),
  })
);

// ============================================================
// Analytics (computed)
// ============================================================

export const tradeGrades = pgTable(
  "trade_grades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    rosterId: integer("roster_id").notNull(),
    // FantasyCalc component
    valueScore: real("value_score"), // normalized 0-100, based on % of total trade value received
    fantasyCalcValue: real("fantasy_calc_value"), // raw sum of FantasyCalc values received
    // Production component
    productionScore: real("production_score"), // normalized 0-100, based on PPG vs positional average
    productionWeeks: integer("production_weeks"), // how many weeks of data used
    // Blended result
    blendedScore: real("blended_score"), // weighted combination of value + production
    productionWeight: real("production_weight"), // 0-1, how much production influenced this grade
    grade: text("grade"), // A+, A, B+, B, C, D, F
    computedAt: timestamp("computed_at", { mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (tg) => ({
    txIdx: index("trade_grades_tx_idx").on(tg.transactionId),
    uniqueTrade: uniqueIndex("trade_grades_unique_idx").on(
      tg.transactionId,
      tg.rosterId
    ),
  })
);

export const draftGrades = pgTable(
  "draft_grades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    pickNo: integer("pick_no").notNull(),
    rosterId: integer("roster_id").notNull(),
    playerId: text("player_id"),
    // FantasyCalc component
    valueScore: real("value_score"),
    playerValue: real("player_value"),
    benchmarkValue: real("benchmark_value"),
    // Production component
    productionScore: real("production_score"),
    playerProduction: real("player_production"),
    benchmarkProduction: real("benchmark_production"),
    // Blended result
    blendedScore: real("blended_score"),
    productionWeight: real("production_weight"),
    grade: text("grade"),
    benchmarkSize: integer("benchmark_size"),
    computedAt: timestamp("computed_at", { mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (dg) => ({
    draftIdx: index("draft_grades_draft_idx").on(dg.draftId),
    playerIdx: index("draft_grades_player_idx").on(dg.playerId),
    uniquePick: uniqueIndex("draft_grades_unique_idx").on(
      dg.draftId,
      dg.pickNo,
    ),
  })
);

export const managerMetrics = pgTable(
  "manager_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: text("league_id").notNull(),
    managerId: text("manager_id").notNull(), // Sleeper user_id
    metric: text("metric").notNull(), // draft_score, trade_score, waiver_score, lineup_score, overall_score
    scope: text("scope").notNull(), // all_time, season:2024, etc
    value: real("value").notNull(),
    percentile: real("percentile"), // 0-100 within league
    meta: jsonb("meta"),
    computedAt: timestamp("computed_at", { mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (mm) => ({
    uniqueMetric: uniqueIndex("manager_metrics_unique_idx").on(
      mm.leagueId,
      mm.managerId,
      mm.metric,
      mm.scope
    ),
  })
);

export const fantasyCalcValues = pgTable(
  "fantasy_calc_values",
  {
    playerId: text("player_id").notNull(), // Mapped to Sleeper player_id
    isSuperFlex: boolean("is_super_flex").notNull().default(false),
    ppr: real("ppr").notNull().default(0.5),
    playerName: text("player_name"),
    value: real("value").notNull(),
    rank: integer("rank"),
    positionRank: integer("position_rank"),
    position: text("position"),
    team: text("team"),
    fetchedAt: timestamp("fetched_at", { mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (fcv) => ({
    pk: primaryKey({ columns: [fcv.playerId, fcv.isSuperFlex, fcv.ppr] }),
  })
);

// ============================================================
// System
// ============================================================

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(), // league_sync, player_sync, nfl_data_sync
    ref: text("ref"), // e.g. league_id or family root league id
    status: text("status").notNull().default("running"), // running, success, failed
    total: integer("total").default(0),
    done: integer("done").default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { mode: "date" }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { mode: "date" }),
  },
  (sj) => ({
    refStatusIdx: index("sync_jobs_ref_status_idx").on(sj.ref, sj.status),
  })
);

// ============================================================
// Experiments
// ============================================================

export const experimentRuns = pgTable(
  "experiment_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(), // e.g. "par-vs-rank", "blend-sensitivity"
    hypothesis: text("hypothesis"),
    config: jsonb("config"), // parameters/settings used for this run
    metrics: jsonb("metrics"), // structured output: correlations, distributions, etc.
    rawData: jsonb("raw_data"), // detailed per-item results for drill-down
    familyId: text("family_id"), // optional: which league family was analyzed
    status: text("status").notNull().default("running"), // running, success, failed
    error: text("error"),
    startedAt: timestamp("started_at", { mode: "date" }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { mode: "date" }),
  },
  (er) => ({
    nameIdx: index("experiment_runs_name_idx").on(er.name),
  })
);

export const syncWatermarks = pgTable(
  "sync_watermarks",
  {
    leagueId: text("league_id").notNull(),
    dataType: text("data_type").notNull(), // 'matchups', 'transactions'
    lastWeek: integer("last_week").notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at", { mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (sw) => ({
    pk: primaryKey({ columns: [sw.leagueId, sw.dataType] }),
  })
);
