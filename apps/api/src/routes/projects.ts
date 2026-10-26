// Projects, members and invitations (ADR 0007, 0008, 0015). Projects are BetterAuth organizations, but every change
// goes through these routes so single ownership and our role rules are enforced in one place.

import {
  channel,
  type Db,
  instanceInvitation,
  oauthResource,
  positionStage,
  project,
  projectInvitation,
  projectMember,
  type Tx,
  user,
} from "@crm/db";
import { newUuid, PROJECT_ROLES, type ProjectRole, permissionsOf } from "@crm/shared";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import defaults from "../../../../config/project-defaults.json" with { type: "json" };
import { badRequest, conflict, errorResponses, notFound } from "../http/errors.js";
import {
  defineRoute,
  jsonBody,
  jsonResponse,
  NoContent,
  ProjectParams,
  pathId,
  publicId,
  Timestamp,
  uuidOf,
  withProject,
} from "../http/route.js";
import { iso, pid } from "../http/serialize.js";
import type { Actor, AppEnv } from "../http/types.js";
import { audit } from "../services/core.js";

const ProjectRoleSchema = z.enum(PROJECT_ROLES).openapi("ProjectRole");
const AssignableRole = z
  .enum(["editor", "commenter", "viewer"])
  .openapi({ description: "Ownership changes only through transferOwnership" });

const ProjectSchema = z
  .object({
    id: publicId("project"),
    name: z.string(),
    role: ProjectRoleSchema,
    permissions: z.array(z.string()).openapi({ description: "Effective permissions of the caller in this project" }),
    mcpUrl: z.url().openapi({ description: "MCP server URL bound to this project" }),
    createdAt: Timestamp,
  })
  .openapi("Project");

const MemberSchema = z
  .object({
    userId: publicId("user"),
    name: z.string(),
    email: z.string(),
    role: ProjectRoleSchema,
    joinedAt: Timestamp,
  })
  .openapi("Member");

const InvitationSchema = z
  .object({
    id: publicId("invitation"),
    projectId: publicId("project"),
    projectName: z.string(),
    email: z.string(),
    role: ProjectRoleSchema,
    status: z.string(),
    expiresAt: Timestamp,
  })
  .openapi("Invitation");

const InstanceInvitationSchema = z
  .object({ email: z.string(), createdAt: Timestamp, usedAt: Timestamp.nullable() })
  .openapi("InstanceInvitation");

const UserSchema = z
  .object({
    id: publicId("user"),
    name: z.string(),
    email: z.string(),
    timezone: z.string(),
    isInstanceAdmin: z.boolean(),
  })
  .openapi("User");

// ---------------------------------------------------------------------------
// Service functions

export function mcpUrlFor(publicUrl: string, projectUuid: string) {
  return new URL(`/mcp/projects/${pid("project", projectUuid)}`, publicUrl).toString();
}

function projectView(row: { id: string; name: string; createdAt: Date }, role: ProjectRole, publicUrl: string) {
  return {
    id: pid("project", row.id),
    name: row.name,
    role,
    permissions: permissionsOf(role),
    mcpUrl: mcpUrlFor(publicUrl, row.id),
    createdAt: iso(row.createdAt),
  };
}

/** Creates a project owned by the actor, seeded from config/project-defaults.json (ADR 0003). */
export async function createProject(db: Db, actor: Actor, name: string, publicUrl: string) {
  return db.transaction(async (tx) => {
    const id = newUuid();
    const createdAt = new Date();
    await tx.insert(project).values({ id, name, slug: `p-${id}`, createdAt });
    await tx
      .insert(projectMember)
      .values({ id: newUuid(), organizationId: id, userId: actor.userId, role: "owner", createdAt });
    await tx.insert(channel).values(
      defaults.channels.map((ch) => ({
        id: newUuid(),
        projectId: id,
        name: ch.name,
        kind: ch.kind,
        url: "url" in ch ? ch.url : null,
        createdBy: actor.userId,
      })),
    );
    await tx.insert(positionStage).values(
      defaults.stages.map((st, i) => ({
        id: newUuid(),
        projectId: id,
        key: st.key,
        label: st.label,
        order: i,
        suggestOnActionTypes: st.suggestOnActionTypes,
        createdBy: actor.userId,
      })),
    );
    // Each project is its own OAuth protected resource for MCP (ADR 0010).
    await tx.insert(oauthResource).values({
      id: newUuid(),
      identifier: mcpUrlFor(publicUrl, id),
      name: `Apply CRM project ${name}`,
      createdAt,
      updatedAt: createdAt,
    });
    await audit(
      tx,
      { db, actor, projectId: id },
      { entityType: "project", entityId: id, op: "create", diff: { name } },
    );
    return projectView({ id, name, createdAt }, "owner", publicUrl);
  });
}

async function loadMember(db: Tx, projectId: string, userId: string) {
  const [row] = await db
    .select({ userId: projectMember.userId, role: projectMember.role })
    .from(projectMember)
    .where(and(eq(projectMember.organizationId, projectId), eq(projectMember.userId, userId)))
    .limit(1);
  return row;
}

// ---------------------------------------------------------------------------
// Routes

const listMyProjects = defineRoute({
  method: "get",
  path: "/api/projects",
  operationId: "listMyProjects",
  summary: "List projects you belong to",
  description: "Returns every project the caller is a member of, with the caller's role and permissions in each.",
  scope: "user",
  permissions: [],
  tags: ["Projects"],
  responses: {
    200: jsonResponse(z.object({ items: z.array(ProjectSchema) }), "Projects"),
    ...errorResponses(),
  },
});

const createProjectRoute = defineRoute({
  method: "post",
  path: "/api/projects",
  operationId: "createProject",
  summary: "Create a project",
  description: "Creates a project owned by the caller, seeded with the default channels and pipeline stages.",
  scope: "user",
  permissions: [],
  tags: ["Projects"],
  request: { body: jsonBody(z.object({ name: z.string().trim().min(1).max(200) })) },
  responses: { 201: jsonResponse(ProjectSchema, "Created"), ...errorResponses() },
});

const getProject = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}",
  operationId: "getProject",
  summary: "Get a project",
  description: "Returns the project with the caller's role and effective permissions.",
  scope: "project",
  permissions: ["project:read"],
  tags: ["Projects"],
  request: { params: ProjectParams },
  responses: { 200: jsonResponse(ProjectSchema, "Project"), ...errorResponses(404) },
});

const updateProject = defineRoute({
  method: "patch",
  path: "/api/projects/{projectId}",
  operationId: "updateProject",
  summary: "Rename a project",
  description: "Changes the project's name.",
  scope: "project",
  permissions: ["project:update"],
  tags: ["Projects"],
  request: { params: ProjectParams, body: jsonBody(z.object({ name: z.string().trim().min(1).max(200) })) },
  responses: { 200: jsonResponse(ProjectSchema, "Project"), ...errorResponses(403, 404) },
});

const deleteProject = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}",
  operationId: "deleteProject",
  summary: "Delete a project",
  description: "Permanently deletes the project and all of its data. Owner only.",
  scope: "project",
  permissions: ["organization:delete"],
  tags: ["Projects"],
  request: { params: ProjectParams },
  responses: { 204: NoContent, ...errorResponses(403, 404) },
});

const transferOwnership = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/transfer-ownership",
  operationId: "transferOwnership",
  summary: "Transfer project ownership",
  description: "Makes another member the owner. The previous owner becomes an editor.",
  scope: "project",
  permissions: ["project:transfer"],
  tags: ["Members"],
  request: { params: ProjectParams, body: jsonBody(z.object({ userId: publicId("user") })) },
  responses: { 204: NoContent, ...errorResponses(400, 403, 404) },
});

const listMembers = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/members",
  operationId: "listMembers",
  summary: "List project members",
  description: "Lists everyone with access to the project and their role. Use member user IDs as action assignees.",
  scope: "project",
  permissions: ["membership:read"],
  mcp: { expose: true },
  tags: ["Members"],
  request: { params: ProjectParams },
  responses: { 200: jsonResponse(z.object({ items: z.array(MemberSchema) }), "Members"), ...errorResponses(404) },
});

const updateMember = defineRoute({
  method: "patch",
  path: "/api/projects/{projectId}/members/{userId}",
  operationId: "updateMemberRole",
  summary: "Change a member's role",
  description: "Sets the role of a member other than the owner.",
  scope: "project",
  permissions: ["membership:manage"],
  tags: ["Members"],
  request: {
    params: withProject({ userId: pathId("user", "userId") }),
    body: jsonBody(z.object({ role: AssignableRole })),
  },
  responses: { 200: jsonResponse(MemberSchema, "Member"), ...errorResponses(400, 403, 404) },
});

const removeMember = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/members/{userId}",
  operationId: "removeMember",
  summary: "Remove a member",
  description: "Removes a member other than the owner from the project.",
  scope: "project",
  permissions: ["membership:manage"],
  tags: ["Members"],
  request: { params: withProject({ userId: pathId("user", "userId") }) },
  responses: { 204: NoContent, ...errorResponses(400, 403, 404) },
});

const leaveProject = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/leave",
  operationId: "leaveProject",
  summary: "Leave a project",
  description: "Removes the caller from the project. The owner must transfer ownership first.",
  scope: "project",
  permissions: ["project:read"],
  tags: ["Members"],
  request: { params: ProjectParams },
  responses: { 204: NoContent, ...errorResponses(400, 404) },
});

const listProjectInvitations = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/invitations",
  operationId: "listProjectInvitations",
  summary: "List pending invitations",
  description: "Lists invitations to the project that have not been accepted yet.",
  scope: "project",
  permissions: ["membership:read"],
  tags: ["Members"],
  request: { params: ProjectParams },
  responses: {
    200: jsonResponse(z.object({ items: z.array(InvitationSchema) }), "Invitations"),
    ...errorResponses(404),
  },
});

const createInvitation = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/invitations",
  operationId: "inviteMember",
  summary: "Invite someone to the project",
  description:
    "Invites an email address with a role. The invitation also allows that address to sign up on this instance. " +
    "Members see the whole project, including salaries and other offers.",
  scope: "project",
  permissions: ["membership:manage"],
  tags: ["Members"],
  request: {
    params: ProjectParams,
    body: jsonBody(z.object({ email: z.email().max(320), role: AssignableRole })),
  },
  responses: { 201: jsonResponse(InvitationSchema, "Invitation"), ...errorResponses(403, 404, 409) },
});

const cancelInvitation = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/invitations/{invitationId}",
  operationId: "cancelInvitation",
  summary: "Cancel an invitation",
  description: "Cancels a pending invitation.",
  scope: "project",
  permissions: ["membership:manage"],
  tags: ["Members"],
  request: { params: withProject({ invitationId: pathId("invitation", "invitationId") }) },
  responses: { 204: NoContent, ...errorResponses(403, 404) },
});

const listMyInvitations = defineRoute({
  method: "get",
  path: "/api/invitations",
  operationId: "listMyInvitations",
  summary: "List invitations addressed to you",
  description: "Pending, unexpired project invitations for the caller's email address.",
  scope: "user",
  permissions: [],
  tags: ["Members"],
  responses: { 200: jsonResponse(z.object({ items: z.array(InvitationSchema) }), "Invitations"), ...errorResponses() },
});

const respondInvitation = defineRoute({
  method: "post",
  path: "/api/invitations/{invitationId}/{decision}",
  operationId: "respondToInvitation",
  summary: "Accept or decline an invitation",
  description: "Accepting adds the caller to the project with the invited role.",
  scope: "user",
  permissions: [],
  tags: ["Members"],
  request: {
    params: z.object({
      invitationId: pathId("invitation", "invitationId"),
      decision: z.enum(["accept", "decline"]).openapi({ param: { name: "decision", in: "path" } }),
    }),
  },
  responses: { 204: NoContent, ...errorResponses(404, 409) },
});

const getMe = defineRoute({
  method: "get",
  path: "/api/me",
  operationId: "getMe",
  summary: "Get the current user",
  description: "Returns the signed-in user.",
  scope: "user",
  permissions: [],
  tags: ["Account"],
  responses: { 200: jsonResponse(UserSchema, "User"), ...errorResponses() },
});

const updateMe = defineRoute({
  method: "patch",
  path: "/api/me",
  operationId: "updateMe",
  summary: "Update your profile",
  description: "Changes the display name or the IANA timezone used for agenda day boundaries.",
  scope: "user",
  permissions: [],
  tags: ["Account"],
  request: {
    body: jsonBody(
      z.object({
        name: z.string().trim().min(1).max(200).optional(),
        timezone: z
          .string()
          .refine(isTimeZone, "Unknown IANA timezone")
          .optional()
          .openapi({ example: "Europe/Berlin" }),
      }),
    ),
  },
  responses: { 200: jsonResponse(UserSchema, "User"), ...errorResponses() },
});

const getInstanceConfig = defineRoute({
  method: "get",
  path: "/api/config",
  operationId: "getInstanceConfig",
  summary: "Public instance configuration",
  description: "What the sign-in page needs to know: enabled social providers and whether the instance is unclaimed.",
  scope: "public",
  permissions: [],
  tags: ["Account"],
  responses: {
    200: jsonResponse(
      z
        .object({
          socialProviders: z.array(z.enum(["google", "github"])),
          unclaimed: z
            .boolean()
            .openapi({ description: "No user exists yet; the first sign-up becomes instance admin" }),
        })
        .openapi("InstanceConfig"),
      "Configuration",
    ),
  },
});

const listInstanceInvitations = defineRoute({
  method: "get",
  path: "/api/admin/invitations",
  operationId: "listInstanceInvitations",
  summary: "List instance sign-up invitations",
  description: "Email addresses allowed to sign up on this instance.",
  scope: "instance_admin",
  permissions: [],
  tags: ["Admin"],
  responses: {
    200: jsonResponse(z.object({ items: z.array(InstanceInvitationSchema) }), "Invitations"),
    ...errorResponses(403),
  },
});

const createInstanceInvitation = defineRoute({
  method: "post",
  path: "/api/admin/invitations",
  operationId: "createInstanceInvitation",
  summary: "Allow an email address to sign up",
  description: "Sign-up is invite-only after the first user (ADR 0021).",
  scope: "instance_admin",
  permissions: [],
  tags: ["Admin"],
  request: { body: jsonBody(z.object({ email: z.email().max(320) })) },
  responses: { 201: jsonResponse(InstanceInvitationSchema, "Invitation"), ...errorResponses(403, 409) },
});

function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function invitationView(row: {
  id: string;
  organizationId: string;
  projectName: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
}) {
  return {
    id: pid("invitation", row.id),
    projectId: pid("project", row.organizationId),
    projectName: row.projectName,
    email: row.email,
    role: (row.role ?? "viewer") as ProjectRole,
    status: row.status,
    expiresAt: iso(row.expiresAt),
  };
}

const invitationColumns = {
  id: projectInvitation.id,
  organizationId: projectInvitation.organizationId,
  projectName: project.name,
  email: projectInvitation.email,
  role: projectInvitation.role,
  status: projectInvitation.status,
  expiresAt: projectInvitation.expiresAt,
};

export function registerProjectRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listMyProjects, async (c) => {
    const { db, env } = c.get("deps");
    const actor = c.get("actor")!;
    const rows = await db
      .select({ id: project.id, name: project.name, createdAt: project.createdAt, role: projectMember.role })
      .from(projectMember)
      .innerJoin(project, eq(project.id, projectMember.organizationId))
      .where(eq(projectMember.userId, actor.userId))
      .orderBy(asc(project.name));
    return c.json({ items: rows.map((r) => projectView(r, r.role as ProjectRole, env.PUBLIC_URL)) }, 200);
  });

  app.openapi(createProjectRoute, async (c) => {
    const { db, env } = c.get("deps");
    const created = await createProject(db, c.get("actor")!, c.req.valid("json").name, env.PUBLIC_URL);
    return c.json(created, 201);
  });

  app.openapi(getProject, async (c) => {
    const { db, env } = c.get("deps");
    const scope = c.get("project");
    const [row] = await db.select().from(project).where(eq(project.id, scope.id));
    if (!row) throw notFound("Project");
    return c.json(projectView(row, scope.role, env.PUBLIC_URL), 200);
  });

  app.openapi(updateProject, async (c) => {
    const { db, env } = c.get("deps");
    const scope = c.get("project");
    const { name } = c.req.valid("json");
    const row = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(project).where(eq(project.id, scope.id));
      const [after] = await tx.update(project).set({ name }).where(eq(project.id, scope.id)).returning();
      await audit(
        tx,
        { db, actor: c.get("actor")!, projectId: scope.id },
        { entityType: "project", entityId: scope.id, op: "update", diff: { name: { from: before?.name, to: name } } },
      );
      return after!;
    });
    return c.json(projectView(row, scope.role, env.PUBLIC_URL), 200);
  });

  app.openapi(deleteProject, async (c) => {
    const { db, env } = c.get("deps");
    const scope = c.get("project");
    await db.transaction(async (tx) => {
      await tx.delete(oauthResource).where(eq(oauthResource.identifier, mcpUrlFor(env.PUBLIC_URL, scope.id)));
      await tx.delete(project).where(eq(project.id, scope.id));
    });
    return c.body(null, 204);
  });

  app.openapi(transferOwnership, async (c) => {
    const { db } = c.get("deps");
    const scope = c.get("project");
    const actor = c.get("actor")!;
    const target = uuidOf("user", c.req.valid("json").userId);
    if (target === actor.userId) throw badRequest("You already own this project");
    await db.transaction(async (tx) => {
      const member = await loadMember(tx, scope.id, target);
      if (!member) throw notFound("Member");
      await tx
        .update(projectMember)
        .set({ role: "editor" })
        .where(and(eq(projectMember.organizationId, scope.id), eq(projectMember.userId, actor.userId)));
      await tx
        .update(projectMember)
        .set({ role: "owner" })
        .where(and(eq(projectMember.organizationId, scope.id), eq(projectMember.userId, target)));
      await audit(
        tx,
        { db, actor, projectId: scope.id },
        {
          entityType: "project",
          entityId: scope.id,
          op: "update",
          diff: { owner: { from: actor.userId, to: target } },
        },
      );
    });
    return c.body(null, 204);
  });

  app.openapi(listMembers, async (c) => {
    const { db } = c.get("deps");
    const rows = await db
      .select({
        userId: projectMember.userId,
        role: projectMember.role,
        joinedAt: projectMember.createdAt,
        name: user.name,
        email: user.email,
      })
      .from(projectMember)
      .innerJoin(user, eq(user.id, projectMember.userId))
      .where(eq(projectMember.organizationId, c.get("project").id))
      .orderBy(asc(user.name));
    return c.json(
      {
        items: rows.map((r) => ({
          userId: pid("user", r.userId),
          name: r.name,
          email: r.email,
          role: r.role as ProjectRole,
          joinedAt: iso(r.joinedAt),
        })),
      },
      200,
    );
  });

  app.openapi(updateMember, async (c) => {
    const { db } = c.get("deps");
    const scope = c.get("project");
    const target = uuidOf("user", c.req.valid("param").userId);
    const { role } = c.req.valid("json");
    const member = await loadMember(db, scope.id, target);
    if (!member) throw notFound("Member");
    if (member.role === "owner") throw badRequest("The owner's role changes only through ownership transfer");
    await db.transaction(async (tx) => {
      await tx
        .update(projectMember)
        .set({ role })
        .where(and(eq(projectMember.organizationId, scope.id), eq(projectMember.userId, target)));
      await audit(
        tx,
        { db, actor: c.get("actor")!, projectId: scope.id },
        { entityType: "member", entityId: target, op: "update", diff: { role: { from: member.role, to: role } } },
      );
    });
    const [row] = await db
      .select({ name: user.name, email: user.email, joinedAt: projectMember.createdAt })
      .from(projectMember)
      .innerJoin(user, eq(user.id, projectMember.userId))
      .where(and(eq(projectMember.organizationId, scope.id), eq(projectMember.userId, target)));
    return c.json(
      { userId: pid("user", target), name: row!.name, email: row!.email, role, joinedAt: iso(row!.joinedAt) },
      200,
    );
  });

  app.openapi(removeMember, async (c) => {
    const { db } = c.get("deps");
    const scope = c.get("project");
    const target = uuidOf("user", c.req.valid("param").userId);
    const member = await loadMember(db, scope.id, target);
    if (!member) throw notFound("Member");
    if (member.role === "owner") throw badRequest("The owner cannot be removed; transfer ownership first");
    await db.transaction(async (tx) => {
      await tx
        .delete(projectMember)
        .where(and(eq(projectMember.organizationId, scope.id), eq(projectMember.userId, target)));
      await audit(
        tx,
        { db, actor: c.get("actor")!, projectId: scope.id },
        { entityType: "member", entityId: target, op: "delete", diff: { role: member.role } },
      );
    });
    return c.body(null, 204);
  });

  app.openapi(leaveProject, async (c) => {
    const { db } = c.get("deps");
    const scope = c.get("project");
    const actor = c.get("actor")!;
    if (scope.role === "owner") throw badRequest("Transfer ownership before leaving the project");
    await db.transaction(async (tx) => {
      await tx
        .delete(projectMember)
        .where(and(eq(projectMember.organizationId, scope.id), eq(projectMember.userId, actor.userId)));
      await audit(
        tx,
        { db, actor, projectId: scope.id },
        { entityType: "member", entityId: actor.userId, op: "delete", diff: { left: true } },
      );
    });
    return c.body(null, 204);
  });

  app.openapi(listProjectInvitations, async (c) => {
    const { db } = c.get("deps");
    const rows = await db
      .select(invitationColumns)
      .from(projectInvitation)
      .innerJoin(project, eq(project.id, projectInvitation.organizationId))
      .where(and(eq(projectInvitation.organizationId, c.get("project").id), eq(projectInvitation.status, "pending")));
    return c.json({ items: rows.map(invitationView) }, 200);
  });

  app.openapi(createInvitation, async (c) => {
    const { db } = c.get("deps");
    const scope = c.get("project");
    const actor = c.get("actor")!;
    const body = c.req.valid("json");
    const email = body.email.toLowerCase();
    const [existingMember] = await db
      .select({ id: projectMember.id })
      .from(projectMember)
      .innerJoin(user, eq(user.id, projectMember.userId))
      .where(and(eq(projectMember.organizationId, scope.id), sql`lower(${user.email}) = ${email}`));
    if (existingMember) throw conflict("That person is already a member");
    const invitation = await db.transaction(async (tx) => {
      // Re-inviting replaces the previous pending invitation.
      await tx
        .update(projectInvitation)
        .set({ status: "canceled" })
        .where(
          and(
            eq(projectInvitation.organizationId, scope.id),
            eq(projectInvitation.email, email),
            eq(projectInvitation.status, "pending"),
          ),
        );
      const [row] = await tx
        .insert(projectInvitation)
        .values({
          id: newUuid(),
          organizationId: scope.id,
          email,
          role: body.role,
          status: "pending",
          expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
          inviterId: actor.userId,
        })
        .returning();
      await audit(
        tx,
        { db, actor, projectId: scope.id },
        { entityType: "invitation", entityId: row!.id, op: "create", diff: { email, role: body.role } },
      );
      return row!;
    });
    const [proj] = await db.select({ name: project.name }).from(project).where(eq(project.id, scope.id));
    return c.json(invitationView({ ...invitation, projectName: proj!.name }), 201);
  });

  app.openapi(cancelInvitation, async (c) => {
    const { db } = c.get("deps");
    const scope = c.get("project");
    const id = uuidOf("invitation", c.req.valid("param").invitationId);
    const rows = await db
      .update(projectInvitation)
      .set({ status: "canceled" })
      .where(
        and(
          eq(projectInvitation.id, id),
          eq(projectInvitation.organizationId, scope.id),
          eq(projectInvitation.status, "pending"),
        ),
      )
      .returning({ id: projectInvitation.id });
    if (rows.length === 0) throw notFound("Invitation");
    return c.body(null, 204);
  });

  app.openapi(listMyInvitations, async (c) => {
    const { db } = c.get("deps");
    const actor = c.get("actor")!;
    const rows = await db
      .select(invitationColumns)
      .from(projectInvitation)
      .innerJoin(project, eq(project.id, projectInvitation.organizationId))
      .where(
        and(
          eq(projectInvitation.email, actor.email.toLowerCase()),
          eq(projectInvitation.status, "pending"),
          gt(projectInvitation.expiresAt, new Date()),
        ),
      );
    return c.json({ items: rows.map(invitationView) }, 200);
  });

  app.openapi(respondInvitation, async (c) => {
    const { db } = c.get("deps");
    const actor = c.get("actor")!;
    const { invitationId, decision } = c.req.valid("param");
    const id = uuidOf("invitation", invitationId);
    await db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(projectInvitation)
        .where(
          and(
            eq(projectInvitation.id, id),
            eq(projectInvitation.email, actor.email.toLowerCase()),
            eq(projectInvitation.status, "pending"),
            gt(projectInvitation.expiresAt, new Date()),
          ),
        )
        .for("update");
      if (!invite) throw notFound("Invitation");
      if (decision === "decline") {
        await tx.update(projectInvitation).set({ status: "rejected" }).where(eq(projectInvitation.id, id));
        return;
      }
      const existing = await loadMember(tx, invite.organizationId, actor.userId);
      if (existing) throw conflict("You are already a member of this project");
      const role = invite.role && invite.role !== "owner" ? invite.role : "viewer";
      await tx.insert(projectMember).values({
        id: newUuid(),
        organizationId: invite.organizationId,
        userId: actor.userId,
        role,
        createdAt: new Date(),
      });
      await tx.update(projectInvitation).set({ status: "accepted" }).where(eq(projectInvitation.id, id));
      await audit(
        tx,
        { db, actor, projectId: invite.organizationId },
        { entityType: "member", entityId: actor.userId, op: "create", diff: { role, invitationId: id } },
      );
    });
    return c.body(null, 204);
  });

  app.openapi(getMe, async (c) => {
    const actor = c.get("actor")!;
    return c.json(
      {
        id: pid("user", actor.userId),
        name: actor.name,
        email: actor.email,
        timezone: actor.timezone,
        isInstanceAdmin: actor.isInstanceAdmin,
      },
      200,
    );
  });

  app.openapi(updateMe, async (c) => {
    const { db } = c.get("deps");
    const actor = c.get("actor")!;
    const body = c.req.valid("json");
    const [row] = await db
      .update(user)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.timezone ? { timezone: body.timezone } : {}),
        updatedAt: new Date(),
      })
      .where(eq(user.id, actor.userId))
      .returning();
    return c.json(
      {
        id: pid("user", row!.id),
        name: row!.name,
        email: row!.email,
        timezone: row!.timezone,
        isInstanceAdmin: row!.isInstanceAdmin,
      },
      200,
    );
  });

  app.openapi(getInstanceConfig, async (c) => {
    const { db, env } = c.get("deps");
    const [first] = await db.select({ id: user.id }).from(user).limit(1);
    const socialProviders: ("google" | "github")[] = [];
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) socialProviders.push("google");
    if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) socialProviders.push("github");
    return c.json({ socialProviders, unclaimed: !first }, 200);
  });

  app.openapi(listInstanceInvitations, async (c) => {
    const { db } = c.get("deps");
    const rows = await db.select().from(instanceInvitation).orderBy(asc(instanceInvitation.email));
    return c.json(
      {
        items: rows.map((r) => ({
          email: r.email,
          createdAt: iso(r.createdAt),
          usedAt: r.usedAt ? iso(r.usedAt) : null,
        })),
      },
      200,
    );
  });

  app.openapi(createInstanceInvitation, async (c) => {
    const { db } = c.get("deps");
    const actor = c.get("actor")!;
    const email = c.req.valid("json").email.toLowerCase();
    const [existingUser] = await db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`);
    if (existingUser) throw conflict("A user with that email already exists");
    const [row] = await db
      .insert(instanceInvitation)
      .values({ id: newUuid(), email, invitedBy: actor.userId })
      .onConflictDoUpdate({ target: instanceInvitation.email, set: { usedAt: null, invitedBy: actor.userId } })
      .returning();
    return c.json({ email: row!.email, createdAt: iso(row!.createdAt), usedAt: null }, 201);
  });
}
