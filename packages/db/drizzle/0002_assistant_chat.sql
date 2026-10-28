CREATE TABLE "ai_credential" (
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"last4" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_credential_user_id_provider_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "chat" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"model" text NOT NULL,
	"approval_mode" text NOT NULL,
	"web_search" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_attachment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"blob_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"chat_id" uuid NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_message_chat_id_id_pk" PRIMARY KEY("chat_id","id")
);
--> statement-breakpoint
ALTER TABLE "ai_credential" ADD CONSTRAINT "ai_credential_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachment" ADD CONSTRAINT "chat_attachment_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_owner_idx" ON "chat" USING btree ("project_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "chat_attachment_chat_idx" ON "chat_attachment" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_message_seq_idx" ON "chat_message" USING btree ("chat_id","seq");