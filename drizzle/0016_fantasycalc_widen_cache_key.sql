ALTER TABLE "fantasy_calc_values" ADD COLUMN "num_teams" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "fantasy_calc_values" ADD COLUMN "num_qbs" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "fantasy_calc_values" DROP CONSTRAINT IF EXISTS "fantasy_calc_values_player_id_is_super_flex_ppr_pk";--> statement-breakpoint
ALTER TABLE "fantasy_calc_values" ADD CONSTRAINT "fantasy_calc_values_player_id_is_super_flex_ppr_num_teams_num_qbs_pk" PRIMARY KEY("player_id","is_super_flex","ppr","num_teams","num_qbs");
