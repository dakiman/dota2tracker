ALTER TABLE "hero_builds" ALTER COLUMN "last_updated" SET DATA TYPE timestamp with time zone USING "last_updated" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "player_matches" ALTER COLUMN "start_time" SET DATA TYPE timestamp with time zone USING "start_time" AT TIME ZONE 'UTC';
