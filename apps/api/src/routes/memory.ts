// Assistant memory (ADR 0032): the user's private memory, shared by all of their projects, and the project's memory,
// shared by its members. Both are plain notes that agents read in their instructions and keep up to date.

import { projectMemory, userMemory } from "@crm/db";
import { newUuid } from "@crm/shared";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, eq, sql } from "drizzle-orm";
import { ApiError, errorResponses, notFound } from "../http/errors.js";
import {
  defineRoute,
  etag,
  expectedVersion,
  jsonBody,
  jsonResponse,
  NoContent,
  pathId,
  publicId,
  Timestamp,
  uuidOf,
  VersionField,
  withProject,
} from "../http/route.js";
import { scopeOf } from "../http/scope.js";
import { iso, pid } from "../http/serialize.js";
import type { AppEnv } from "../http/types.js";
import { audit, changes, softDelete, updateVersioned, visible } from "../services/core.js";

const MemoryInput = z.object({
  title: z.string().trim().min(1).max(200).openapi({ description: "What the memory is about, in one line" }),
  content: z.string().trim().min(1).max(10_000).openapi({ description: "Markdown" }),
});
const MemoryUpdate = MemoryInput.partial().extend({ version: VersionField.optional() });
const VersionQuery = z.object({ version: z.coerce.number().int().optional() });

const memoryFields = {
  title: z.string(),
  content: z.string().openapi({ description: "Markdown" }),
  version: z.int(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
};
const UserMemorySchema = z.object({ id: publicId("userMemory"), ...memoryFields }).openapi("UserMemory");
const ProjectMemorySchema = z.object({ id: publicId("projectMemory"), ...memoryFields }).openapi("ProjectMemory");

type UserMemoryRow = typeof userMemory.$inferSelect;
type ProjectMemoryRow = typeof projectMemory.$inferSelect;

const view = (id: string, r: UserMemoryRow | ProjectMemoryRow) => ({
  id,
  title: r.title,
  content: r.content,
  version: r.version,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});
const userMemoryView = (r: UserMemoryRow) => view(pid("userMemory", r.id), r);
const projectMemoryView = (r: ProjectMemoryRow) => view(pid("projectMemory", r.id), r);

const UserMemoryParams = z.object({ memoryId: pathId("userMemory", "memoryId") });
const ProjectMemoryParams = withProject({ memoryId: pathId("projectMemory", "memoryId") });

const tags = ["Memory"];

const listUserMemories = defineRoute({
  method: "get",
  path: "/api/me/memories",
  operationId: "listUserMemories",
  summary: "List your memories",
  description: "Your private memory: facts about you that agents reuse in all of your projects. Oldest first.",
  scope: "user",
  permissions: [],
  mcp: { expose: true },
  tags,
  responses: { 200: jsonResponse(z.object({ items: z.array(UserMemorySchema) }), "Memories") },
});

const createUserMemory = defineRoute({
  method: "post",
  path: "/api/me/memories",
  operationId: "createUserMemory",
  summary: "Remember something about you",
  description:
    "Saves a fact about the user that applies in all of their projects (background, preferences, writing style, …). " +
    "Only the user can see it. Update an existing memory on the same topic instead of adding a near-duplicate.",
  scope: "user",
  permissions: [],
  mcp: { expose: true },
  tags,
  request: { body: jsonBody(MemoryInput) },
  responses: { 201: jsonResponse(UserMemorySchema, "Created") },
});

const updateUserMemory = defineRoute({
  method: "patch",
  path: "/api/me/memories/{memoryId}",
  operationId: "updateUserMemory",
  summary: "Update one of your memories",
  description: "Changes the title or content of a memory. Pass the current `version`.",
  scope: "user",
  permissions: [],
  mcp: { expose: true },
  tags,
  request: { params: UserMemoryParams, body: jsonBody(MemoryUpdate) },
  responses: { 200: jsonResponse(UserMemorySchema, "Updated"), ...errorResponses(404, 412, 428) },
});

const deleteUserMemory = defineRoute({
  method: "delete",
  path: "/api/me/memories/{memoryId}",
  operationId: "deleteUserMemory",
  summary: "Forget one of your memories",
  description: "Deletes a memory for good. Pass the current `version`.",
  scope: "user",
  permissions: [],
  mcp: { expose: true },
  tags,
  request: { params: UserMemoryParams, query: VersionQuery },
  responses: { 204: NoContent, ...errorResponses(404, 412, 428) },
});

const listProjectMemories = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/memories",
  operationId: "listProjectMemories",
  summary: "List the project's memories",
  description: "Facts about this job search that agents reuse, shared with every member. Oldest first.",
  scope: "project",
  permissions: ["memory:read"],
  mcp: { expose: true },
  tags,
  request: { params: withProject({}) },
  responses: { 200: jsonResponse(z.object({ items: z.array(ProjectMemorySchema) }), "Memories") },
});

const createProjectMemory = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/memories",
  operationId: "createProjectMemory",
  summary: "Remember something about this project",
  description:
    "Saves a fact about this job search (goals, constraints, decisions, context that fits no CRM record), shared " +
    "with every member. Update an existing memory on the same topic instead of adding a near-duplicate.",
  scope: "project",
  permissions: ["memory:create"],
  mcp: { expose: true },
  tags,
  request: { params: withProject({}), body: jsonBody(MemoryInput) },
  responses: { 201: jsonResponse(ProjectMemorySchema, "Created"), ...errorResponses(403) },
});

const updateProjectMemory = defineRoute({
  method: "patch",
  path: "/api/projects/{projectId}/memories/{memoryId}",
  operationId: "updateProjectMemory",
  summary: "Update a project memory",
  description: "Changes the title or content of a memory. Pass the current `version`.",
  scope: "project",
  permissions: ["memory:update"],
  mcp: { expose: true },
  tags,
  request: { params: ProjectMemoryParams, body: jsonBody(MemoryUpdate) },
  responses: { 200: jsonResponse(ProjectMemorySchema, "Updated"), ...errorResponses(403, 404, 412, 428) },
});

const deleteProjectMemory = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/memories/{memoryId}",
  operationId: "deleteProjectMemory",
  summary: "Forget a project memory",
  description: "Deletes a memory. Pass the current `version`.",
  scope: "project",
  permissions: ["memory:delete"],
  mcp: { expose: true },
  tags,
  request: { params: ProjectMemoryParams, query: VersionQuery },
  responses: { 204: NoContent, ...errorResponses(403, 404, 412, 428) },
});

export function registerMemoryRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listUserMemories, async (c) => {
    const rows = await c.var.deps.db
      .select()
      .from(userMemory)
      .where(eq(userMemory.userId, c.var.actor!.userId))
      .orderBy(asc(userMemory.id));
    return c.json({ items: rows.map(userMemoryView) }, 200);
  });

  app.openapi(createUserMemory, async (c) => {
    const [row] = await c.var.deps.db
      .insert(userMemory)
      .values({ id: newUuid(), userId: c.var.actor!.userId, ...c.req.valid("json") })
      .returning();
    return c.json(userMemoryView(row!), 201);
  });

  app.openapi(updateUserMemory, async (c) => {
    const { version, ...set } = c.req.valid("json");
    const id = uuidOf("userMemory", c.req.valid("param").memoryId);
    const row = await c.var.deps.db.transaction(async (tx) => {
      const own = and(eq(userMemory.id, id), eq(userMemory.userId, c.var.actor!.userId));
      const [before] = await tx.select().from(userMemory).where(own).for("update");
      if (!before) throw notFound("Memory");
      const expected = expectedVersion(c, version);
      if (before.version !== expected) {
        throw new ApiError(412, "Memory was changed in the meantime", { currentVersion: before.version });
      }
      const [after] = await tx
        .update(userMemory)
        .set({ ...set, version: sql`${userMemory.version} + 1`, updatedAt: new Date() })
        .where(own)
        .returning();
      return after!;
    });
    c.header("ETag", etag(row.version));
    return c.json(userMemoryView(row), 200);
  });

  app.openapi(deleteUserMemory, async (c) => {
    const id = uuidOf("userMemory", c.req.valid("param").memoryId);
    const expected = expectedVersion(c, c.req.valid("query").version);
    await c.var.deps.db.transaction(async (tx) => {
      const own = and(eq(userMemory.id, id), eq(userMemory.userId, c.var.actor!.userId));
      const [current] = await tx.select().from(userMemory).where(own).for("update");
      if (!current) throw notFound("Memory");
      if (current.version !== expected) {
        throw new ApiError(412, "Memory was changed in the meantime", { currentVersion: current.version });
      }
      await tx.delete(userMemory).where(own);
    });
    return c.body(null, 204);
  });

  app.openapi(listProjectMemories, async (c) => {
    const s = scopeOf(c);
    const rows = await s.db
      .select()
      .from(projectMemory)
      .where(visible(projectMemory, s))
      .orderBy(asc(projectMemory.id));
    return c.json({ items: rows.map(projectMemoryView) }, 200);
  });

  app.openapi(createProjectMemory, async (c) => {
    const s = scopeOf(c);
    const body = c.req.valid("json");
    const row = await s.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(projectMemory)
        .values({ id: newUuid(), projectId: s.projectId, createdBy: s.actor.userId, ...body })
        .returning();
      await audit(tx, s, { entityType: "memory", entityId: created!.id, op: "create", diff: body });
      return created!;
    });
    return c.json(projectMemoryView(row), 201);
  });

  app.openapi(updateProjectMemory, async (c) => {
    const s = scopeOf(c);
    const { version, ...set } = c.req.valid("json");
    const id = uuidOf("projectMemory", c.req.valid("param").memoryId);
    const row = await s.db.transaction(async (tx) => {
      const { before, after } = await updateVersioned<typeof projectMemory, ProjectMemoryRow>(tx, projectMemory, s, {
        id,
        expectedVersion: expectedVersion(c, version),
        set,
        entityName: "Memory",
      });
      await audit(tx, s, { entityType: "memory", entityId: id, op: "update", diff: changes(before, after) });
      return after;
    });
    c.header("ETag", etag(row.version));
    return c.json(projectMemoryView(row), 200);
  });

  app.openapi(deleteProjectMemory, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("projectMemory", c.req.valid("param").memoryId);
    const version = expectedVersion(c, c.req.valid("query").version);
    await s.db.transaction((tx) =>
      softDelete(tx, projectMemory, s, { id, expectedVersion: version, entityName: "Memory", entityType: "memory" }),
    );
    return c.body(null, 204);
  });
}
