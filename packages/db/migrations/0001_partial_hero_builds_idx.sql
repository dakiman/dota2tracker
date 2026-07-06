DROP INDEX IF EXISTS "hero_role_player_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hero_role_global_idx" ON "hero_builds" ("hero_slug","role") WHERE player_id IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hero_role_player_idx" ON "hero_builds" ("hero_slug","role","player_id") WHERE player_id IS NOT NULL;
