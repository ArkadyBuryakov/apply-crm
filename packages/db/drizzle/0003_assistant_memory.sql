CREATE TABLE "project_memory" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"title" text NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_memory" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_memory" ADD CONSTRAINT "project_memory_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memory" ADD CONSTRAINT "project_memory_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory" ADD CONSTRAINT "user_memory_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_memory_project_idx" ON "project_memory" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "user_memory_user_idx" ON "user_memory" USING btree ("user_id");