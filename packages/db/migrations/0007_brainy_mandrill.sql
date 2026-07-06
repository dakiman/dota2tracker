CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'steam' NOT NULL,
	"steam_id" text NOT NULL,
	"player_id" text,
	"name" text DEFAULT '' NOT NULL,
	"avatar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_provider_steam_idx" ON "users" USING btree ("provider","steam_id");