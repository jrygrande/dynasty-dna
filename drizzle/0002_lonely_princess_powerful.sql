CREATE TABLE "draft_grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" text NOT NULL,
	"pick_no" integer NOT NULL,
	"roster_id" integer NOT NULL,
	"player_id" text,
	"value_score" real,
	"player_value" real,
	"benchmark_value" real,
	"production_score" real,
	"player_production" real,
	"benchmark_production" real,
	"blended_score" real,
	"production_weight" real,
	"grade" text,
	"benchmark_size" integer,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_grades" ADD CONSTRAINT "draft_grades_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_grades_draft_idx" ON "draft_grades" USING btree ("draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_grades_unique_idx" ON "draft_grades" USING btree ("draft_id","pick_no");