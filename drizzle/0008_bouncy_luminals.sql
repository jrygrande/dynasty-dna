CREATE TABLE "algorithm_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config" jsonb NOT NULL,
	"experiment_id" uuid,
	"is_active" boolean DEFAULT false NOT NULL,
	"promoted_by" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "algorithm_config" ADD CONSTRAINT "algorithm_config_experiment_id_experiment_runs_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiment_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "algorithm_config_active_idx" ON "algorithm_config" USING btree ("is_active");