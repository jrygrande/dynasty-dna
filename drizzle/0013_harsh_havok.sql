ALTER TABLE "league_families" ADD COLUMN "demo_eligible" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "league_families_demo_singleton" ON "league_families" ((1)) WHERE "demo_eligible" = true;
--> statement-breakpoint
UPDATE "league_families" SET "demo_eligible" = true WHERE "id" = 'afc3acf8-2d18-47c9-80c1-998252c9a06a';
