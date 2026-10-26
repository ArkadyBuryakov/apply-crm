-- Exactly one owner per project and one membership per user (ADR 0007). BetterAuth's generated schema has neither.
CREATE UNIQUE INDEX "project_member_one_owner_uq" ON "project_member" ("organization_id") WHERE "role" = 'owner';
--> statement-breakpoint
CREATE UNIQUE INDEX "project_member_user_uq" ON "project_member" ("organization_id", "user_id");
