ALTER TABLE "sync_jobs" ADD COLUMN "trigger" text;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "api_calls_made" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "stages_completed" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "stages_total" integer;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "current_stage" text;--> statement-breakpoint
CREATE INDEX "sync_jobs_started_at_idx" ON "sync_jobs" USING btree ("started_at");