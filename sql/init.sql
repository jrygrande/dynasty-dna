-- Enable extensions used for UUID generation and JSONB ops
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- users
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL,
  display_name text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users (username);

-- leagues
CREATE TABLE IF NOT EXISTS leagues (
  id text PRIMARY KEY,
  name text NOT NULL,
  season text NOT NULL,
  previous_league_id text,
  settings jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leagues_previous_league_id_idx ON leagues (previous_league_id);
CREATE INDEX IF NOT EXISTS leagues_season_idx ON leagues (season);

-- rosters (composite PK per league)
CREATE TABLE IF NOT EXISTS rosters (
  league_id text NOT NULL,
  roster_id integer NOT NULL,
  owner_id text NOT NULL,
  CONSTRAINT rosters_pk PRIMARY KEY (league_id, roster_id)
);
CREATE INDEX IF NOT EXISTS rosters_league_id_idx ON rosters (league_id);
CREATE INDEX IF NOT EXISTS rosters_owner_id_idx ON rosters (owner_id);

-- players
CREATE TABLE IF NOT EXISTS players (
  id text PRIMARY KEY,
  name text NOT NULL,
  position text,
  team text,
  status text
);

-- transactions
CREATE TABLE IF NOT EXISTS transactions (
  id text PRIMARY KEY,
  league_id text NOT NULL,
  week integer,
  type text NOT NULL,
  payload jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_league_week_idx ON transactions (league_id, week);
CREATE INDEX IF NOT EXISTS transactions_type_idx ON transactions (type);

-- matchups
CREATE TABLE IF NOT EXISTS matchups (
  league_id text NOT NULL,
  week integer NOT NULL,
  roster_id integer NOT NULL,
  starters jsonb,
  players jsonb,
  points numeric(10,2) NOT NULL DEFAULT 0,
  CONSTRAINT matchups_pk PRIMARY KEY (league_id, week, roster_id)
);
CREATE INDEX IF NOT EXISTS matchups_league_week_idx ON matchups (league_id, week);

-- drafts
CREATE TABLE IF NOT EXISTS drafts (
  id text PRIMARY KEY,
  league_id text NOT NULL,
  season text NOT NULL,
  settings jsonb
);
CREATE INDEX IF NOT EXISTS drafts_league_idx ON drafts (league_id);

-- draft_picks
CREATE TABLE IF NOT EXISTS draft_picks (
  draft_id text NOT NULL,
  pick_no integer NOT NULL,
  round integer NOT NULL,
  roster_id integer,
  player_id text,
  is_keeper boolean DEFAULT false,
  traded_from_roster_id integer,
  CONSTRAINT draft_picks_pk PRIMARY KEY (draft_id, pick_no)
);
CREATE INDEX IF NOT EXISTS draft_picks_round_idx ON draft_picks (draft_id, round);
CREATE INDEX IF NOT EXISTS draft_picks_player_idx ON draft_picks (player_id);

-- traded_picks
CREATE TABLE IF NOT EXISTS traded_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id text NOT NULL,
  season text NOT NULL,
  round integer NOT NULL,
  original_roster_id integer NOT NULL,
  current_owner_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS traded_picks_league_season_idx ON traded_picks (league_id, season);

-- metric_snapshots
CREATE TABLE IF NOT EXISTS metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id text NOT NULL,
  manager_id text NOT NULL,
  scope text NOT NULL,
  metric text NOT NULL,
  value numeric(12,4) NOT NULL,
  meta jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS metric_snapshots_unique ON metric_snapshots (league_id, manager_id, metric, scope);

