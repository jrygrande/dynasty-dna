import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';

let dbInstance: ReturnType<typeof drizzle> | undefined;

async function init() {
  if (dbInstance) return dbInstance;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // Clean Neon param not needed for fetch-based driver, but safe to strip
  let cleanedUrl = url;
  try {
    const u = new URL(url);
    if (u.searchParams.has('channel_binding')) u.searchParams.delete('channel_binding');
    cleanedUrl = u.toString();
  } catch {
    cleanedUrl = url.replace(/([?&])channel_binding=[^&]*/i, '$1').replace(/[?&]$/, '');
  }
  const client = neon(cleanedUrl);
  dbInstance = drizzle(client);
  await ensureSchema(dbInstance);
  return dbInstance;
}

export async function getDb() {
  return init();
}

export async function persistDb() {
  // No-op for Postgres (serverless driver)
}

async function ensureSchema(db: ReturnType<typeof drizzle>) {
  // Create tables/indexes if they don't exist. Safe to call multiple times.
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  // users
  await db.execute(sql`CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    username text NOT NULL,
    display_name text,
    created_at timestamp NOT NULL DEFAULT now()
  );`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users (username);`);
  // leagues
  await db.execute(sql`CREATE TABLE IF NOT EXISTS leagues (
    id text PRIMARY KEY,
    name text NOT NULL,
    season text NOT NULL,
    previous_league_id text,
    settings jsonb,
    created_at timestamp NOT NULL DEFAULT now()
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS leagues_previous_league_id_idx ON leagues (previous_league_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS leagues_season_idx ON leagues (season);`);
  // rosters
  await db.execute(sql`CREATE TABLE IF NOT EXISTS rosters (
    league_id text NOT NULL,
    roster_id integer NOT NULL,
    owner_id text NOT NULL,
    CONSTRAINT rosters_pk PRIMARY KEY (league_id, roster_id)
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS rosters_league_id_idx ON rosters (league_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS rosters_owner_id_idx ON rosters (owner_id);`);
  // players
  await db.execute(sql`CREATE TABLE IF NOT EXISTS players (
    id text PRIMARY KEY,
    name text NOT NULL,
    position text,
    team text,
    status text,
    updated_at timestamp NOT NULL DEFAULT now()
  );`);
  await db.execute(sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();`);
  // transactions
  await db.execute(sql`CREATE TABLE IF NOT EXISTS transactions (
    id text PRIMARY KEY,
    league_id text NOT NULL,
    week integer,
    type text NOT NULL,
    payload jsonb,
    created_at timestamp NOT NULL DEFAULT now()
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS transactions_league_week_idx ON transactions (league_id, week);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS transactions_type_idx ON transactions (type);`);
  // matchups
  await db.execute(sql`CREATE TABLE IF NOT EXISTS matchups (
    league_id text NOT NULL,
    week integer NOT NULL,
    roster_id integer NOT NULL,
    starters jsonb,
    players jsonb,
    points numeric(10,2) NOT NULL DEFAULT 0,
    CONSTRAINT matchups_pk PRIMARY KEY (league_id, week, roster_id)
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS matchups_league_week_idx ON matchups (league_id, week);`);
  // drafts
  await db.execute(sql`CREATE TABLE IF NOT EXISTS drafts (
    id text PRIMARY KEY,
    league_id text NOT NULL,
    season text NOT NULL,
    start_time timestamp,
    settings jsonb
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS drafts_league_idx ON drafts (league_id);`);
  await db.execute(sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS start_time timestamp;`);
  // draft_picks
  await db.execute(sql`CREATE TABLE IF NOT EXISTS draft_picks (
    draft_id text NOT NULL,
    pick_no integer NOT NULL,
    round integer NOT NULL,
    roster_id integer,
    player_id text,
    is_keeper boolean DEFAULT false,
    traded_from_roster_id integer,
    CONSTRAINT draft_picks_pk PRIMARY KEY (draft_id, pick_no)
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS draft_picks_round_idx ON draft_picks (draft_id, round);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS draft_picks_player_idx ON draft_picks (player_id);`);
  // traded_picks
  await db.execute(sql`CREATE TABLE IF NOT EXISTS traded_picks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id text NOT NULL,
    season text NOT NULL,
    round integer NOT NULL,
    original_roster_id integer NOT NULL,
    current_owner_id text NOT NULL
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS traded_picks_league_season_idx ON traded_picks (league_id, season);`);
  // asset_events
  await db.execute(sql`CREATE TABLE IF NOT EXISTS asset_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id text NOT NULL,
    season text,
    week integer,
    event_time timestamp,
    event_type text NOT NULL,
    asset_kind text NOT NULL,
    player_id text,
    pick_season text,
    pick_round integer,
    pick_original_roster_id integer,
    from_user_id text,
    to_user_id text,
    from_roster_id integer,
    to_roster_id integer,
    transaction_id text,
    details jsonb,
    created_at timestamp NOT NULL DEFAULT now()
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS asset_events_league_idx ON asset_events (league_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS asset_events_player_idx ON asset_events (asset_kind, player_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS asset_events_pick_idx ON asset_events (asset_kind, pick_season, pick_round, pick_original_roster_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS asset_events_time_idx ON asset_events (season, week, event_time);`);
  // nfl_state
  await db.execute(sql`CREATE TABLE IF NOT EXISTS nfl_state (
    id text PRIMARY KEY,
    season text NOT NULL,
    week integer NOT NULL,
    fetched_at timestamp NOT NULL DEFAULT now()
  );`);
  // nfl_seasons
  await db.execute(sql`CREATE TABLE IF NOT EXISTS nfl_seasons (
    season text PRIMARY KEY,
    max_week integer NOT NULL,
    note text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  );`);
  // metric_snapshots
  await db.execute(sql`CREATE TABLE IF NOT EXISTS metric_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id text NOT NULL,
    manager_id text NOT NULL,
    scope text NOT NULL,
    metric text NOT NULL,
    value numeric(12,4) NOT NULL,
    meta jsonb,
    created_at timestamp NOT NULL DEFAULT now()
  );`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS metric_snapshots_unique ON metric_snapshots (league_id, manager_id, metric, scope);`);
  // job_runs
  await db.execute(sql`CREATE TABLE IF NOT EXISTS job_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type text NOT NULL,
    ref text,
    status text NOT NULL DEFAULT 'running',
    total integer,
    done integer DEFAULT 0,
    error text,
    started_at timestamp NOT NULL DEFAULT now(),
    finished_at timestamp
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS job_runs_type_ref_idx ON job_runs (type, ref);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS job_runs_started_idx ON job_runs (started_at DESC);`);
}
