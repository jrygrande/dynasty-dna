CREATE TABLE "nflverse_watermarks" (
	"source" text NOT NULL,
	"season" integer NOT NULL,
	"last_synced_week" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nflverse_watermarks_source_season_pk" PRIMARY KEY("source","season")
);
