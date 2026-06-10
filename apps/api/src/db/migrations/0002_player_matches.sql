CREATE TABLE IF NOT EXISTS "heroes" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_matches" (
	"player_id" text NOT NULL,
	"match_id" bigint NOT NULL,
	"hero_id" integer NOT NULL,
	"won" boolean NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"deaths" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"duration" integer NOT NULL,
	"start_time" timestamp NOT NULL,
	"lane_role" smallint,
	"is_roaming" boolean,
	"role" text NOT NULL,
	CONSTRAINT "player_matches_player_id_match_id_pk" PRIMARY KEY ("player_id","match_id"),
	CONSTRAINT "player_matches_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_matches_hero_idx" ON "player_matches" ("hero_id");
