CREATE TABLE "answers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"question_key" text NOT NULL,
	"mode" text NOT NULL,
	"work_id" text NOT NULL,
	"category" text NOT NULL,
	"tier" text NOT NULL,
	"correct" integer NOT NULL,
	"points" integer NOT NULL,
	"method" text NOT NULL,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"room_code" text,
	"role" text,
	"elapsed_ms" integer,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" text PRIMARY KEY NOT NULL,
	"work_id" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drawings" (
	"id" text PRIMARY KEY NOT NULL,
	"room_code" text NOT NULL,
	"user_id" text NOT NULL,
	"work_id" text NOT NULL,
	"subject" text NOT NULL,
	"png" text NOT NULL,
	"votes_best" integer DEFAULT 0 NOT NULL,
	"votes_funny" integer DEFAULT 0 NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"work_id" text NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"question_key" text NOT NULL,
	"work_id" text,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"code" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"room_code" text NOT NULL,
	"summary" jsonb NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "themes" (
	"id" text PRIMARY KEY NOT NULL,
	"work_id" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch" (
	"user_id" text NOT NULL,
	"work_id" text NOT NULL,
	"status" text NOT NULL,
	"rating" integer,
	"at" bigint NOT NULL,
	CONSTRAINT "watch_user_id_work_id_pk" PRIMARY KEY("user_id","work_id")
);
--> statement-breakpoint
CREATE TABLE "wishlist" (
	"user_id" text NOT NULL,
	"work_id" text NOT NULL,
	"at" bigint NOT NULL,
	CONSTRAINT "wishlist_user_id_work_id_pk" PRIMARY KEY("user_id","work_id")
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"tier" text NOT NULL,
	"popularity" double precision DEFAULT 0 NOT NULL,
	"score" double precision,
	"year" integer,
	"title" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "answers_user" ON "answers" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "answers_key" ON "answers" USING btree ("question_key");--> statement-breakpoint
CREATE INDEX "answers_room" ON "answers" USING btree ("room_code");--> statement-breakpoint
CREATE INDEX "characters_work" ON "characters" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "watch_work" ON "watch" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "works_cat_tier" ON "works" USING btree ("category","tier");