CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "oauth_access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"refresh_id" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"revoked" timestamp,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_access_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"client_credentials_scopes" text[] DEFAULT '{}',
	"user_id" text,
	"created_at" timestamp,
	"updated_at" timestamp,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" text[],
	"response_types" text[],
	"require_pkce" boolean,
	"dpop_bound_access_tokens" boolean DEFAULT false,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "oauth_client_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_client_assertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_client_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"scopes" text[] NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"revoked" timestamp,
	"rotated_at" timestamp,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp,
	"auth_time" timestamp,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_refresh_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauth_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"created_at" timestamp,
	"updated_at" timestamp,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb,
	CONSTRAINT "oauth_resource_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "project_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "project_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"is_instance_admin" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"scheduled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"channel_id" uuid,
	"assignee_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(notes, '')) || jsonb_to_tsvector('simple', payload, '["string"]')) STORED,
	CONSTRAINT "action_project_id_id" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "action_attachment" (
	"project_id" text NOT NULL,
	"action_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	CONSTRAINT "action_attachment_action_id_document_version_id_pk" PRIMARY KEY("action_id","document_version_id")
);
--> statement-breakpoint
CREATE TABLE "action_edge" (
	"project_id" text NOT NULL,
	"parent_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "action_edge_parent_id_child_id_kind_pk" PRIMARY KEY("parent_id","child_id","kind"),
	CONSTRAINT "action_edge_no_self_loop_ck" CHECK ("action_edge"."parent_id" <> "action_edge"."child_id")
);
--> statement-breakpoint
CREATE TABLE "action_participant" (
	"project_id" text NOT NULL,
	"action_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "action_participant_action_id_contact_id_role_pk" PRIMARY KEY("action_id","contact_id","role")
);
--> statement-breakpoint
CREATE TABLE "action_subject" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"action_id" uuid NOT NULL,
	"position_id" uuid,
	"organization_id" uuid,
	CONSTRAINT "action_subject_exactly_one_ck" CHECK (num_nonnulls("action_subject"."position_id", "action_subject"."organization_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"actor_user_id" text,
	"via" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"op" text NOT NULL,
	"diff" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"url" text,
	CONSTRAINT "channel_project_id_id" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"notes" text,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(notes, ''))) STORED,
	CONSTRAINT "contact_project_id_id" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "contact_affiliation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"contact_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text,
	"from_date" date,
	"to_date" date
);
--> statement-breakpoint
CREATE TABLE "contact_handle" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"contact_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"position_id" uuid,
	"derived_from_version_id" uuid,
	"notes" text,
	CONSTRAINT "document_project_id_id" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "document_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"notes" text,
	CONSTRAINT "document_template_project_id_id" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "document_template_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"template_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"files" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "document_template_version_project_id_id" UNIQUE("project_id","id"),
	CONSTRAINT "document_template_version_no_uq" UNIQUE("template_id","version_no")
);
--> statement-breakpoint
CREATE TABLE "document_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"blob_key" text,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"source" text,
	"template_version_id" uuid,
	"pdf_blob_key" text,
	"compile_status" text,
	"compile_log" text,
	"compiled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "document_version_project_id_id" UNIQUE("project_id","id"),
	CONSTRAINT "document_version_no_uq" UNIQUE("document_id","version_no"),
	CONSTRAINT "document_version_content_ck" CHECK (num_nonnulls("document_version"."blob_key", "document_version"."source") = 1)
);
--> statement-breakpoint
CREATE TABLE "instance_invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "instance_invitation_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"notes" text,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(website, '') || ' ' || coalesce(notes, ''))) STORED,
	CONSTRAINT "organization_project_id_id" UNIQUE("project_id","id"),
	CONSTRAINT "organization_kind_ck" CHECK ("organization"."kind" in ('company', 'agency'))
);
--> statement-breakpoint
CREATE TABLE "position" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"title" text NOT NULL,
	"company_id" uuid,
	"agency_id" uuid,
	"url" text,
	"description_markdown" text,
	"salary_min" numeric,
	"salary_max" numeric,
	"salary_currency" text,
	"salary_period" text,
	"stage_id" uuid NOT NULL,
	"outcome" text DEFAULT 'open' NOT NULL,
	"source_channel_id" uuid,
	"notes" text,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description_markdown, '') || ' ' || coalesce(notes, ''))) STORED,
	CONSTRAINT "position_project_id_id" UNIQUE("project_id","id"),
	CONSTRAINT "position_outcome_ck" CHECK ("position"."outcome" in ('open', 'accepted', 'rejected', 'withdrawn', 'ghosted'))
);
--> statement-breakpoint
CREATE TABLE "position_stage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"order" integer NOT NULL,
	"suggest_on_action_types" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "position_stage_project_id_id" UNIQUE("project_id","id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refresh_id_oauth_refresh_token_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."oauth_refresh_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_resource_id_oauth_resource_identifier_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."oauth_resource"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invitation" ADD CONSTRAINT "project_invitation_organization_id_project_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invitation" ADD CONSTRAINT "project_invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_organization_id_project_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action" ADD CONSTRAINT "action_channel_fk" FOREIGN KEY ("project_id","channel_id") REFERENCES "public"."channel"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_attachment" ADD CONSTRAINT "action_attachment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_attachment" ADD CONSTRAINT "action_attachment_action_fk" FOREIGN KEY ("project_id","action_id") REFERENCES "public"."action"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_attachment" ADD CONSTRAINT "action_attachment_version_fk" FOREIGN KEY ("project_id","document_version_id") REFERENCES "public"."document_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_edge" ADD CONSTRAINT "action_edge_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_edge" ADD CONSTRAINT "action_edge_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_edge" ADD CONSTRAINT "action_edge_parent_fk" FOREIGN KEY ("project_id","parent_id") REFERENCES "public"."action"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_edge" ADD CONSTRAINT "action_edge_child_fk" FOREIGN KEY ("project_id","child_id") REFERENCES "public"."action"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_participant" ADD CONSTRAINT "action_participant_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_participant" ADD CONSTRAINT "action_participant_action_fk" FOREIGN KEY ("project_id","action_id") REFERENCES "public"."action"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_participant" ADD CONSTRAINT "action_participant_contact_fk" FOREIGN KEY ("project_id","contact_id") REFERENCES "public"."contact"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_subject" ADD CONSTRAINT "action_subject_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_subject" ADD CONSTRAINT "action_subject_action_fk" FOREIGN KEY ("project_id","action_id") REFERENCES "public"."action"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_subject" ADD CONSTRAINT "action_subject_position_fk" FOREIGN KEY ("project_id","position_id") REFERENCES "public"."position"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_subject" ADD CONSTRAINT "action_subject_org_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."organization"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_affiliation" ADD CONSTRAINT "contact_affiliation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_affiliation" ADD CONSTRAINT "contact_affiliation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_affiliation" ADD CONSTRAINT "contact_affiliation_project_id_contact_id_contact_project_id_id_fk" FOREIGN KEY ("project_id","contact_id") REFERENCES "public"."contact"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_affiliation" ADD CONSTRAINT "contact_affiliation_project_id_organization_id_organization_project_id_id_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."organization"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_handle" ADD CONSTRAINT "contact_handle_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_handle" ADD CONSTRAINT "contact_handle_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_handle" ADD CONSTRAINT "contact_handle_project_id_contact_id_contact_project_id_id_fk" FOREIGN KEY ("project_id","contact_id") REFERENCES "public"."contact"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_handle" ADD CONSTRAINT "contact_handle_project_id_channel_id_channel_project_id_id_fk" FOREIGN KEY ("project_id","channel_id") REFERENCES "public"."channel"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_position_fk" FOREIGN KEY ("project_id","position_id") REFERENCES "public"."position"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template" ADD CONSTRAINT "document_template_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template" ADD CONSTRAINT "document_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_version" ADD CONSTRAINT "document_template_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_version" ADD CONSTRAINT "document_template_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_version" ADD CONSTRAINT "document_template_version_template_fk" FOREIGN KEY ("project_id","template_id") REFERENCES "public"."document_template"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_document_fk" FOREIGN KEY ("project_id","document_id") REFERENCES "public"."document"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_template_fk" FOREIGN KEY ("project_id","template_version_id") REFERENCES "public"."document_template_version"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_invitation" ADD CONSTRAINT "instance_invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."organization"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_agency_fk" FOREIGN KEY ("project_id","agency_id") REFERENCES "public"."organization"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_stage_fk" FOREIGN KEY ("project_id","stage_id") REFERENCES "public"."position_stage"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_source_channel_fk" FOREIGN KEY ("project_id","source_channel_id") REFERENCES "public"."channel"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_stage" ADD CONSTRAINT "position_stage_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_stage" ADD CONSTRAINT "position_stage_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_clientId_idx" ON "oauth_access_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_sessionId_idx" ON "oauth_access_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_userId_idx" ON "oauth_access_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauth_access_token" USING btree ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_refreshId_idx" ON "oauth_access_token" USING btree ("refresh_id");--> statement-breakpoint
CREATE INDEX "oauthClient_userId_idx" ON "oauth_client" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_uidx" ON "oauth_client_resource" USING btree ("client_id","resource_id");--> statement-breakpoint
CREATE INDEX "oauthClientResource_clientId_idx" ON "oauth_client_resource" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauth_client_resource" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "oauthConsent_clientId_idx" ON "oauth_consent" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauthConsent_userId_idx" ON "oauth_consent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_clientId_idx" ON "oauth_refresh_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_sessionId_idx" ON "oauth_refresh_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_userId_idx" ON "oauth_refresh_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauth_refresh_token" USING btree ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "projectInvitation_organizationId_idx" ON "project_invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "projectInvitation_email_idx" ON "project_invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "projectMember_organizationId_idx" ON "project_member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "projectMember_userId_idx" ON "project_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "action_project_scheduled_idx" ON "action" USING btree ("project_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "action_project_due_idx" ON "action" USING btree ("project_id","due_at");--> statement-breakpoint
CREATE INDEX "action_assignee_idx" ON "action" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "action_search_idx" ON "action" USING gin ("search");--> statement-breakpoint
CREATE INDEX "action_attachment_version_idx" ON "action_attachment" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "action_edge_child_idx" ON "action_edge" USING btree ("child_id");--> statement-breakpoint
CREATE INDEX "action_participant_contact_idx" ON "action_participant" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_subject_position_uq" ON "action_subject" USING btree ("action_id","position_id") WHERE "action_subject"."position_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "action_subject_org_uq" ON "action_subject" USING btree ("action_id","organization_id") WHERE "action_subject"."organization_id" is not null;--> statement-breakpoint
CREATE INDEX "action_subject_position_idx" ON "action_subject" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "action_subject_org_idx" ON "action_subject" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "audit_event_entity_idx" ON "audit_event" USING btree ("project_id","entity_type","entity_id","at");--> statement-breakpoint
CREATE INDEX "comment_target_idx" ON "comment" USING btree ("project_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "contact_search_idx" ON "contact" USING gin ("search");--> statement-breakpoint
CREATE INDEX "contact_affiliation_contact_idx" ON "contact_affiliation" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_affiliation_org_idx" ON "contact_affiliation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contact_handle_contact_idx" ON "contact_handle" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_handle_value_idx" ON "contact_handle" USING btree ("project_id","value");--> statement-breakpoint
CREATE INDEX "document_position_idx" ON "document" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "organization_search_idx" ON "organization" USING gin ("search");--> statement-breakpoint
CREATE INDEX "position_company_idx" ON "position" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "position_agency_idx" ON "position" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "position_stage_idx" ON "position" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "position_search_idx" ON "position" USING gin ("search");--> statement-breakpoint
CREATE UNIQUE INDEX "position_stage_key_uq" ON "position_stage" USING btree ("project_id","key") WHERE "position_stage"."deleted_at" is null;