CREATE TABLE "waiver_grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" text NOT NULL,
	"roster_id" integer NOT NULL,
	"player_id" text,
	"dropped_player_id" text,
	"value_score" real,
	"player_value" real,
	"dropped_value" real,
	"faab_bid" integer,
	"faab_efficiency" real,
	"production_score" real,
	"production_weeks" integer,
	"raw_par" real,
	"blended_score" real,
	"production_weight" real,
	"grade" text,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiment_runs" ADD COLUMN "scorecard" jsonb;--> statement-breakpoint
ALTER TABLE "trade_grades" ADD COLUMN "raw_par" real;--> statement-breakpoint
ALTER TABLE "waiver_grades" ADD CONSTRAINT "waiver_grades_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waiver_grades_tx_idx" ON "waiver_grades" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "waiver_grades_player_idx" ON "waiver_grades" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_grades_unique_idx" ON "waiver_grades" USING btree ("transaction_id","roster_id");