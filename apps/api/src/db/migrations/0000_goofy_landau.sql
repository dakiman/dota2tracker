CREATE TABLE IF NOT EXISTS "hero_builds" (
	"id" serial PRIMARY KEY NOT NULL,
	"hero_id" integer NOT NULL,
	"hero_slug" text NOT NULL,
	"hero_name" text NOT NULL,
	"role" text NOT NULL,
	"player_id" text,
	"total_matches" integer DEFAULT 0 NOT NULL,
	"win_rate" real DEFAULT 0 NOT NULL,
	"build_data" jsonb NOT NULL,
	"stats_data" jsonb,
	"last_updated" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hero_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"hero_id" integer NOT NULL,
	"hero_name" text NOT NULL,
	"hero_slug" text NOT NULL,
	"role" text NOT NULL,
	"matches" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"deaths" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"last_updated" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "players" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"avatar" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hero_builds" ADD CONSTRAINT "hero_builds_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hero_stats" ADD CONSTRAINT "hero_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hero_role_player_idx" ON "hero_builds" USING btree ("hero_slug","role","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_hero_idx" ON "hero_stats" USING btree ("player_id","hero_id");