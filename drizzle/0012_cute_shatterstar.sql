CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"league_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"notified_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_email_league_unique" ON "waitlist" USING btree ("email","league_id");--> statement-breakpoint
CREATE INDEX "waitlist_league_id_idx" ON "waitlist" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "waitlist_status_idx" ON "waitlist" USING btree ("status");