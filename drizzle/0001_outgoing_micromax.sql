ALTER TABLE "fantasy_calc_values" DROP CONSTRAINT "fantasy_calc_values_player_id_fetched_at_pk";--> statement-breakpoint
ALTER TABLE "fantasy_calc_values" ADD CONSTRAINT "fantasy_calc_values_player_id_is_super_flex_ppr_pk" PRIMARY KEY("player_id","is_super_flex","ppr");--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "slot_to_roster_id" jsonb;--> statement-breakpoint
ALTER TABLE "fantasy_calc_values" ADD COLUMN "is_super_flex" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fantasy_calc_values" ADD COLUMN "ppr" real DEFAULT 0.5 NOT NULL;