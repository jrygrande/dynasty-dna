CREATE TABLE "experiment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"hypothesis" text,
	"config" jsonb,
	"metrics" jsonb,
	"raw_data" jsonb,
	"family_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sync_watermarks" (
	"league_id" text NOT NULL,
	"data_type" text NOT NULL,
	"last_week" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sync_watermarks_league_id_data_type_pk" PRIMARY KEY("league_id","data_type")
);
--> statement-breakpoint
CREATE INDEX "experiment_runs_name_idx" ON "experiment_runs" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "league_families_root_league_id_unique" ON "league_families" USING btree ("root_league_id");--> statement-breakpoint
CREATE INDEX "sync_jobs_ref_status_idx" ON "sync_jobs" USING btree ("ref","status");