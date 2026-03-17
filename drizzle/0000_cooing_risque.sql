CREATE TABLE "accounts" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "asset_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" text NOT NULL,
	"season" text NOT NULL,
	"week" integer NOT NULL,
	"event_type" text NOT NULL,
	"asset_kind" text NOT NULL,
	"player_id" text,
	"pick_season" text,
	"pick_round" integer,
	"pick_original_roster_id" integer,
	"from_roster_id" integer,
	"to_roster_id" integer,
	"from_user_id" text,
	"to_user_id" text,
	"transaction_id" text,
	"details" jsonb,
	"created_at" bigint
);
--> statement-breakpoint
CREATE TABLE "draft_picks" (
	"draft_id" text NOT NULL,
	"pick_no" integer NOT NULL,
	"round" integer NOT NULL,
	"roster_id" integer NOT NULL,
	"player_id" text,
	"is_keeper" boolean DEFAULT false,
	"metadata" jsonb,
	CONSTRAINT "draft_picks_draft_id_pick_no_pk" PRIMARY KEY("draft_id","pick_no")
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"league_id" text NOT NULL,
	"season" text NOT NULL,
	"type" text,
	"status" text,
	"start_time" bigint,
	"settings" jsonb
);
--> statement-breakpoint
CREATE TABLE "fantasy_calc_values" (
	"player_id" text NOT NULL,
	"player_name" text,
	"value" real NOT NULL,
	"rank" integer,
	"position_rank" integer,
	"position" text,
	"team" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fantasy_calc_values_player_id_fetched_at_pk" PRIMARY KEY("player_id","fetched_at")
);
--> statement-breakpoint
CREATE TABLE "league_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_league_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_family_members" (
	"family_id" uuid NOT NULL,
	"league_id" text NOT NULL,
	"season" text NOT NULL,
	CONSTRAINT "league_family_members_family_id_league_id_pk" PRIMARY KEY("family_id","league_id")
);
--> statement-breakpoint
CREATE TABLE "league_users" (
	"league_id" text NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text,
	"team_name" text,
	"avatar" text,
	CONSTRAINT "league_users_league_id_user_id_pk" PRIMARY KEY("league_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"season" text NOT NULL,
	"previous_league_id" text,
	"status" text,
	"settings" jsonb,
	"scoring_settings" jsonb,
	"roster_positions" jsonb,
	"total_rosters" integer,
	"last_synced_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "manager_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" text NOT NULL,
	"manager_id" text NOT NULL,
	"metric" text NOT NULL,
	"scope" text NOT NULL,
	"value" real NOT NULL,
	"percentile" real,
	"meta" jsonb,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matchups" (
	"league_id" text NOT NULL,
	"week" integer NOT NULL,
	"roster_id" integer NOT NULL,
	"matchup_id" integer,
	"points" real DEFAULT 0,
	"starters" jsonb,
	"starter_points" jsonb,
	"players" jsonb,
	"player_points" jsonb,
	CONSTRAINT "matchups_league_id_week_roster_id_pk" PRIMARY KEY("league_id","week","roster_id")
);
--> statement-breakpoint
CREATE TABLE "nfl_injuries" (
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"gsis_id" text NOT NULL,
	"game_type" text,
	"player_name" text,
	"team" text,
	"position" text,
	"report_status" text,
	"report_primary_injury" text,
	"report_secondary_injury" text,
	"practice_status" text,
	"practice_primary_injury" text,
	"practice_secondary_injury" text,
	"date_modified" text,
	CONSTRAINT "nfl_injuries_season_week_gsis_id_pk" PRIMARY KEY("season","week","gsis_id")
);
--> statement-breakpoint
CREATE TABLE "nfl_schedule" (
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"game_date" text,
	CONSTRAINT "nfl_schedule_season_week_home_team_pk" PRIMARY KEY("season","week","home_team")
);
--> statement-breakpoint
CREATE TABLE "nfl_state" (
	"id" text PRIMARY KEY DEFAULT 'nfl' NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"season_type" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nfl_weekly_roster_status" (
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"gsis_id" text NOT NULL,
	"status" text NOT NULL,
	"status_abbr" text,
	"team" text,
	"position" text,
	"player_name" text,
	CONSTRAINT "nfl_weekly_roster_status_season_week_gsis_id_pk" PRIMARY KEY("season","week","gsis_id")
);
--> statement-breakpoint
CREATE TABLE "player_scores" (
	"league_id" text NOT NULL,
	"week" integer NOT NULL,
	"roster_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"points" real DEFAULT 0,
	"is_starter" boolean DEFAULT false,
	CONSTRAINT "player_scores_league_id_week_roster_id_player_id_pk" PRIMARY KEY("league_id","week","roster_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"gsis_id" text,
	"name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"position" text,
	"team" text,
	"age" integer,
	"status" text,
	"injury_status" text,
	"years_exp" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rosters" (
	"league_id" text NOT NULL,
	"roster_id" integer NOT NULL,
	"owner_id" text,
	"players" jsonb,
	"starters" jsonb,
	"reserve" jsonb,
	"wins" integer DEFAULT 0,
	"losses" integer DEFAULT 0,
	"ties" integer DEFAULT 0,
	"fpts" real DEFAULT 0,
	"fpts_against" real DEFAULT 0,
	"settings" jsonb,
	CONSTRAINT "rosters_league_id_roster_id_pk" PRIMARY KEY("league_id","roster_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sleeper_links" (
	"user_id" text NOT NULL,
	"sleeper_id" text NOT NULL,
	"sleeper_username" text NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sleeper_links_user_id_pk" PRIMARY KEY("user_id")
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"ref" text,
	"status" text DEFAULT 'running' NOT NULL,
	"total" integer DEFAULT 0,
	"done" integer DEFAULT 0,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "trade_grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" text NOT NULL,
	"roster_id" integer NOT NULL,
	"value_score" real,
	"fantasy_calc_value" real,
	"production_score" real,
	"production_weeks" integer,
	"blended_score" real,
	"production_weight" real,
	"grade" text,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traded_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" text NOT NULL,
	"season" text NOT NULL,
	"round" integer NOT NULL,
	"original_roster_id" integer NOT NULL,
	"current_owner_id" integer NOT NULL,
	"previous_owner_id" integer
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"league_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"week" integer NOT NULL,
	"roster_ids" jsonb,
	"adds" jsonb,
	"drops" jsonb,
	"draft_picks" jsonb,
	"settings" jsonb,
	"created_at" bigint
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp,
	"image" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_family_members" ADD CONSTRAINT "league_family_members_family_id_league_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."league_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_family_members" ADD CONSTRAINT "league_family_members_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_users" ADD CONSTRAINT "league_users_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sleeper_links" ADD CONSTRAINT "sleeper_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_grades" ADD CONSTRAINT "trade_grades_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traded_picks" ADD CONSTRAINT "traded_picks_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_events_player_idx" ON "asset_events" USING btree ("league_id","player_id");--> statement-breakpoint
CREATE INDEX "asset_events_tx_idx" ON "asset_events" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "asset_events_pick_idx" ON "asset_events" USING btree ("league_id","pick_season","pick_round","pick_original_roster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manager_metrics_unique_idx" ON "manager_metrics" USING btree ("league_id","manager_id","metric","scope");--> statement-breakpoint
CREATE INDEX "nfl_injuries_gsis_idx" ON "nfl_injuries" USING btree ("gsis_id");--> statement-breakpoint
CREATE INDEX "nfl_roster_status_gsis_idx" ON "nfl_weekly_roster_status" USING btree ("gsis_id");--> statement-breakpoint
CREATE INDEX "rosters_owner_idx" ON "rosters" USING btree ("league_id","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sleeper_links_sleeper_id_idx" ON "sleeper_links" USING btree ("sleeper_id");--> statement-breakpoint
CREATE INDEX "trade_grades_tx_idx" ON "trade_grades" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_grades_unique_idx" ON "trade_grades" USING btree ("transaction_id","roster_id");--> statement-breakpoint
CREATE INDEX "traded_picks_league_season_idx" ON "traded_picks" USING btree ("league_id","season");--> statement-breakpoint
CREATE INDEX "transactions_league_week_idx" ON "transactions" USING btree ("league_id","week");