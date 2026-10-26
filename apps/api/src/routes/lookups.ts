// Per-project lookups: channels and pipeline stages (ADR 0002, 0003, 0014).

import { channel, position, positionStage } from "@crm/db";
import { ACTION_TYPES, newUuid } from "@crm/shared";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { conflict, errorResponses } from "../http/errors.js";
import {
  defineRoute,
  etag,
  expectedVersion,
  jsonBody,
  jsonResponse,
  NoContent,
  ProjectParams,
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
import { audit, softDelete, updateVersioned, visible } from "../services/core.js";

export const CHANNEL_KINDS = ["email", "phone", "linkedin", "job_board", "careers_site", "messenger", "other"] as const;

const ChannelSchema = z
  .object({
    id: publicId("channel"),
    name: z.string(),
    kind: z.enum(CHANNEL_KINDS),
    url: z.string().nullable(),
    version: z.int(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Channel");

const ChannelInput = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(CHANNEL_KINDS).default("other"),
  url: z.url().max(2000).nullable().optional(),
});

const StageSchema = z
  .object({
    id: publicId("stage"),
    key: z.string().openapi({ description: "Stable machine name, e.g. `interviewing`" }),
    label: z.string(),
    order: z.int(),
    suggestOnActionTypes: z
      .array(z.enum(ACTION_TYPES))
      .openapi({ description: "Logging a done action of these types suggests moving the position to this stage" }),
    version: z.int(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Stage");

const StageInput = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,49}$/)
    .openapi({ description: "Lowercase letters, digits and underscores" }),
  label: z.string().trim().min(1).max(100),
  order: z.int().min(0).max(1000).optional(),
  suggestOnActionTypes: z.array(z.enum(ACTION_TYPES)).default([]),
});

type ChannelRow = typeof channel.$inferSelect;
type StageRow = typeof positionStage.$inferSelect;

export const channelView = (r: ChannelRow) => ({
  id: pid("channel", r.id),
  name: r.name,
  kind: r.kind as (typeof CHANNEL_KINDS)[number],
  url: r.url,
  version: r.version,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

export const stageView = (r: StageRow) => ({
  id: pid("stage", r.id),
  key: r.key,
  label: r.label,
  order: r.order,
  suggestOnActionTypes: r.suggestOnActionTypes as (typeof ACTION_TYPES)[number][],
  version: r.version,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

const ChannelParams = withProject({ channelId: pathId("channel", "channelId") });
const StageParams = withProject({ stageId: pathId("stage", "stageId") });

const listChannels = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/channels",
  operationId: "listChannels",
  summary: "List channels",
  description:
    "Channels are where applications and conversations happen (email, LinkedIn, phone, job boards, …). " +
    "Use their IDs for a position's source channel, an action's channel and contact handles.",
  scope: "project",
  permissions: ["channel:read"],
  mcp: { expose: true },
  tags: ["Lookups"],
  request: { params: ProjectParams },
  responses: { 200: jsonResponse(z.object({ items: z.array(ChannelSchema) }), "Channels"), ...errorResponses(404) },
});

const createChannel = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/channels",
  operationId: "createChannel",
  summary: "Create a channel",
  description: "Adds a channel to the project.",
  scope: "project",
  permissions: ["channel:create"],
  tags: ["Lookups"],
  request: { params: ProjectParams, body: jsonBody(ChannelInput) },
  responses: { 201: jsonResponse(ChannelSchema, "Created"), ...errorResponses(403, 404) },
});

const updateChannel = defineRoute({
  method: "patch",
  path: "/api/projects/{projectId}/channels/{channelId}",
  operationId: "updateChannel",
  summary: "Update a channel",
  description: "Changes a channel's name, kind or URL.",
  scope: "project",
  permissions: ["channel:update"],
  tags: ["Lookups"],
  request: {
    params: ChannelParams,
    body: jsonBody(ChannelInput.partial().extend({ version: VersionField.optional() })),
  },
  responses: { 200: jsonResponse(ChannelSchema, "Updated"), ...errorResponses(403, 404, 412, 428) },
});

const deleteChannel = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/channels/{channelId}",
  operationId: "deleteChannel",
  summary: "Delete a channel",
  description: "Soft-deletes a channel. Existing references keep pointing at it.",
  scope: "project",
  permissions: ["channel:delete"],
  tags: ["Lookups"],
  request: { params: ChannelParams, query: z.object({ version: z.coerce.number().int().optional() }) },
  responses: { 204: NoContent, ...errorResponses(403, 404, 412, 428) },
});

const listStages = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/stages",
  operationId: "listStages",
  summary: "List pipeline stages",
  description: "Pipeline stages in board order. A position is always in exactly one stage.",
  scope: "project",
  permissions: ["stage:read"],
  mcp: { expose: true },
  tags: ["Lookups"],
  request: { params: ProjectParams },
  responses: { 200: jsonResponse(z.object({ items: z.array(StageSchema) }), "Stages"), ...errorResponses(404) },
});

const createStage = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/stages",
  operationId: "createStage",
  summary: "Create a pipeline stage",
  description: "Adds a stage. Without `order` it goes last.",
  scope: "project",
  permissions: ["stage:create"],
  tags: ["Lookups"],
  request: { params: ProjectParams, body: jsonBody(StageInput) },
  responses: { 201: jsonResponse(StageSchema, "Created"), ...errorResponses(403, 404, 409) },
});

const updateStage = defineRoute({
  method: "patch",
  path: "/api/projects/{projectId}/stages/{stageId}",
  operationId: "updateStage",
  summary: "Update a pipeline stage",
  description: "Renames or reorders a stage, or changes which action types suggest it.",
  scope: "project",
  permissions: ["stage:update"],
  tags: ["Lookups"],
  request: {
    params: StageParams,
    body: jsonBody(StageInput.omit({ key: true }).partial().extend({ version: VersionField.optional() })),
  },
  responses: { 200: jsonResponse(StageSchema, "Updated"), ...errorResponses(403, 404, 412, 428) },
});

const deleteStage = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/stages/{stageId}",
  operationId: "deleteStage",
  summary: "Delete a pipeline stage",
  description: "Deletes a stage that no position uses.",
  scope: "project",
  permissions: ["stage:delete"],
  tags: ["Lookups"],
  request: { params: StageParams, query: z.object({ version: z.coerce.number().int().optional() }) },
  responses: { 204: NoContent, ...errorResponses(403, 404, 409, 412, 428) },
});

export function registerLookupRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listChannels, async (c) => {
    const s = scopeOf(c);
    const rows = await s.db.select().from(channel).where(visible(channel, s)).orderBy(asc(channel.name));
    return c.json({ items: rows.map(channelView) }, 200);
  });

  app.openapi(createChannel, async (c) => {
    const s = scopeOf(c);
    const body = c.req.valid("json");
    const row = await s.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(channel)
        .values({
          id: newUuid(),
          projectId: s.projectId,
          name: body.name,
          kind: body.kind,
          url: body.url ?? null,
          createdBy: s.actor.userId,
        })
        .returning();
      await audit(tx, s, { entityType: "channel", entityId: created!.id, op: "create", diff: { after: body } });
      return created!;
    });
    return c.json(channelView(row), 201);
  });

  app.openapi(updateChannel, async (c) => {
    const s = scopeOf(c);
    const { version, ...set } = c.req.valid("json");
    const id = uuidOf("channel", c.req.valid("param").channelId);
    const row = await s.db.transaction(async (tx) => {
      const { before, after } = await updateVersioned<typeof channel, ChannelRow>(tx, channel, s, {
        id,
        expectedVersion: expectedVersion(c, version),
        set,
        entityName: "Channel",
      });
      await audit(tx, s, { entityType: "channel", entityId: id, op: "update", diff: { before, set } });
      return after;
    });
    c.header("ETag", etag(row.version));
    return c.json(channelView(row), 200);
  });

  app.openapi(deleteChannel, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("channel", c.req.valid("param").channelId);
    const version = expectedVersion(c, c.req.valid("query").version);
    await s.db.transaction((tx) =>
      softDelete(tx, channel, s, { id, expectedVersion: version, entityName: "Channel", entityType: "channel" }),
    );
    return c.body(null, 204);
  });

  app.openapi(listStages, async (c) => {
    const s = scopeOf(c);
    const rows = await s.db
      .select()
      .from(positionStage)
      .where(visible(positionStage, s))
      .orderBy(asc(positionStage.order), asc(positionStage.key));
    return c.json({ items: rows.map(stageView) }, 200);
  });

  app.openapi(createStage, async (c) => {
    const s = scopeOf(c);
    const body = c.req.valid("json");
    const row = await s.db.transaction(async (tx) => {
      const [dup] = await tx
        .select({ id: positionStage.id })
        .from(positionStage)
        .where(and(visible(positionStage, s), eq(positionStage.key, body.key)));
      if (dup) throw conflict(`A stage with key "${body.key}" already exists`);
      const [{ next } = { next: 0 }] = await tx
        .select({ next: sql<number>`coalesce(max(${positionStage.order}) + 1, 0)::int` })
        .from(positionStage)
        .where(visible(positionStage, s));
      const [created] = await tx
        .insert(positionStage)
        .values({
          id: newUuid(),
          projectId: s.projectId,
          key: body.key,
          label: body.label,
          order: body.order ?? next,
          suggestOnActionTypes: body.suggestOnActionTypes,
          createdBy: s.actor.userId,
        })
        .returning();
      await audit(tx, s, { entityType: "stage", entityId: created!.id, op: "create", diff: { after: body } });
      return created!;
    });
    return c.json(stageView(row), 201);
  });

  app.openapi(updateStage, async (c) => {
    const s = scopeOf(c);
    const { version, ...set } = c.req.valid("json");
    const id = uuidOf("stage", c.req.valid("param").stageId);
    const row = await s.db.transaction(async (tx) => {
      const { before, after } = await updateVersioned<typeof positionStage, StageRow>(tx, positionStage, s, {
        id,
        expectedVersion: expectedVersion(c, version),
        set,
        entityName: "Stage",
      });
      await audit(tx, s, { entityType: "stage", entityId: id, op: "update", diff: { before, set } });
      return after;
    });
    return c.json(stageView(row), 200);
  });

  app.openapi(deleteStage, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("stage", c.req.valid("param").stageId);
    const version = expectedVersion(c, c.req.valid("query").version);
    await s.db.transaction(async (tx) => {
      const [used] = await tx
        .select({ id: position.id })
        .from(position)
        .where(and(eq(position.stageId, id), isNull(position.deletedAt)))
        .limit(1);
      if (used) throw conflict("Positions still use this stage; move them first");
      await softDelete(tx, positionStage, s, {
        id,
        expectedVersion: version,
        entityName: "Stage",
        entityType: "stage",
      });
    });
    return c.body(null, 204);
  });
}
