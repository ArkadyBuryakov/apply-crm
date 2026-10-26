// Actions: planned and finished activities (ADR 0004, 0013, 0029).

import { action, actionParticipant, actionSubject, position } from "@crm/db";
import {
  ACTION_PAYLOAD_SCHEMAS,
  ACTION_STATUSES,
  ACTION_TYPES,
  type ActionType,
  ALLOWED_STATUSES,
  PARTICIPANT_ROLES,
} from "@crm/shared";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq, gte, isNotNull, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { errorResponses } from "../http/errors.js";
import {
  defineRoute,
  etag,
  expectedVersion,
  jsonBody,
  jsonResponse,
  ListQuery,
  NoContent,
  ProjectParams,
  page,
  pathId,
  publicId,
  Timestamp,
  uuidOf,
  VersionField,
  withProject,
} from "../http/route.js";
import { scopeOf } from "../http/scope.js";
import type { AppEnv } from "../http/types.js";
import { createAction, loadAction, loadActions, rescheduleAction, updateAction } from "../services/actions.js";
import { cursorCondition, nextCursor, restore, softDelete } from "../services/core.js";
import { prefixQuery } from "../services/search.js";

export const ActionTypeSchema = z.enum(ACTION_TYPES).openapi("ActionType");
export const ActionStatusSchema = z.enum(ACTION_STATUSES).openapi("ActionStatus", {
  description:
    "planned → done | cancelled | no_show | rescheduled. Allowed values depend on the type: offers, rejections and " +
    "notes are always done; only meetings and interviews can be no_show.",
});

export const SubjectSchema = z
  .object({
    positionId: publicId("position").optional(),
    organizationId: publicId("organization").optional(),
  })
  .refine((v) => (v.positionId === undefined) !== (v.organizationId === undefined), {
    message: "Give exactly one of positionId or organizationId",
  })
  .openapi("ActionSubject", {
    description:
      "What the action is about: a position, or an organization when no position exists yet (e.g. an intro call " +
      "with an agency). An action can have several subjects or none (a project-level task).",
  });

export const ParticipantInputSchema = z
  .object({ contactId: publicId("contact"), role: z.enum(PARTICIPANT_ROLES) })
  .openapi("ActionParticipantInput");

const isoDateTime = Timestamp.nullable().optional();

const CommonActionInput = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .openapi({ description: 'Short label for timelines, e.g. "Intro call with recruiter"' }),
  notes: z.string().max(100_000).nullable().optional(),
  status: ActionStatusSchema.optional().openapi({
    description: "Defaults to planned, or done for offer/rejection/note",
  }),
  scheduledAt: isoDateTime.openapi({ description: "When it happens or happened" }),
  completedAt: isoDateTime.openapi({ description: "Set automatically when status becomes done" }),
  dueAt: isoDateTime.openapi({ description: "Deadline (tasks, take-homes, offer decisions)" }),
  channelId: publicId("channel").nullable().optional(),
  assigneeId: publicId("user").nullable().optional().openapi({ description: "Project member; defaults to you" }),
  subjects: z.array(SubjectSchema).max(50).optional(),
  participants: z.array(ParticipantInputSchema).max(100).optional(),
  attachments: z
    .array(publicId("documentVersion"))
    .max(50)
    .optional()
    .openapi({ description: "Exact document versions involved, e.g. the resume version sent" }),
});

const pascal = (t: string) => t.replace(/(^|_)(\w)/g, (_, __, ch: string) => ch.toUpperCase());

function createVariant<T extends ActionType>(type: T) {
  // Rebuilt with this module's `z`: schemas constructed in @crm/shared before @hono/zod-openapi was loaded lack
  // `.openapi()`, because zod 4 attaches methods per instance at construction time.
  const payload = z.object(ACTION_PAYLOAD_SCHEMAS[type].shape);
  return CommonActionInput.extend({
    type: z.literal(type),
    payload: (type === "note" ? payload.optional() : payload).openapi({
      description: `Fields specific to ${type} actions`,
    }),
  }).openapi(`Create${pascal(type)}Action`, {
    description: `Allowed statuses: ${ALLOWED_STATUSES[type].join(", ")}`,
  });
}

export const CreateActionSchema = z
  .discriminatedUnion("type", [
    createVariant("email"),
    createVariant("meeting"),
    createVariant("interview"),
    createVariant("application"),
    createVariant("take_home"),
    createVariant("offer"),
    createVariant("reference_check"),
    createVariant("rejection"),
    createVariant("task"),
    createVariant("note"),
  ])
  .openapi("CreateAction");

const UpdateActionSchema = CommonActionInput.partial()
  .extend({
    payload: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({ description: "Fields to change in the type-specific payload; merged into the current payload" }),
    version: VersionField.optional(),
  })
  .openapi("UpdateAction");

export const ActionSchema = z
  .object({
    id: publicId("action"),
    type: ActionTypeSchema,
    status: ActionStatusSchema,
    title: z.string(),
    notes: z.string().nullable(),
    scheduledAt: Timestamp.nullable(),
    completedAt: Timestamp.nullable(),
    dueAt: Timestamp.nullable(),
    channelId: publicId("channel").nullable(),
    assigneeId: publicId("user").nullable(),
    payload: z.record(z.string(), z.unknown()).openapi({ description: "Type-specific fields" }),
    subjects: z.array(
      z.union([z.object({ positionId: publicId("position") }), z.object({ organizationId: publicId("organization") })]),
    ),
    participants: z.array(
      z.object({ contactId: publicId("contact"), contactName: z.string(), role: z.enum(PARTICIPANT_ROLES) }),
    ),
    attachments: z.array(publicId("documentVersion")),
    version: z.int(),
    createdBy: publicId("user").nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    deletedAt: Timestamp.nullable(),
  })
  .openapi("Action");

export const SuggestionSchema = z
  .object({
    positionId: publicId("position"),
    kind: z.enum(["stage", "outcome"]),
    stageId: publicId("stage").optional(),
    stageKey: z.string().optional(),
    outcome: z.literal("rejected").optional(),
    reason: z.string(),
  })
  .openapi("Suggestion", {
    description: "A suggested position update. Nothing is applied automatically; call updatePosition to accept it.",
  });

export const ActionMutationSchema = z
  .object({ action: ActionSchema, suggestions: z.array(SuggestionSchema) })
  .openapi("ActionMutation");

const ActionParams = withProject({ actionId: pathId("action", "actionId") });

const listActions = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/actions",
  operationId: "listActions",
  summary: "List or search actions",
  description:
    "Emails, meetings, interviews, applications, take-homes, offers, reference checks, rejections, tasks and notes. " +
    "`organizationId` includes actions about the organization's positions. `from`/`to` filter on scheduledAt.",
  scope: "project",
  permissions: ["action:read"],
  mcp: { expose: true },
  tags: ["Actions"],
  request: {
    params: ProjectParams,
    query: ListQuery.extend({
      type: ActionTypeSchema.optional(),
      status: ActionStatusSchema.optional(),
      positionId: publicId("position").optional(),
      organizationId: publicId("organization").optional(),
      contactId: publicId("contact").optional(),
      assigneeId: publicId("user").optional(),
      from: Timestamp.optional(),
      to: Timestamp.optional(),
      q: z.string().max(200).optional(),
      deleted: z.enum(["true", "false"]).optional(),
    }),
  },
  responses: { 200: jsonResponse(page(ActionSchema), "Actions"), ...errorResponses(404) },
});

const getAction = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/actions/{actionId}",
  operationId: "getAction",
  summary: "Get an action",
  description: "Returns one action with its subjects, participants and attachments.",
  scope: "project",
  permissions: ["action:read"],
  mcp: { expose: true },
  tags: ["Actions"],
  request: { params: ActionParams },
  responses: { 200: jsonResponse(ActionSchema, "Action"), ...errorResponses(404) },
});

const createActionRoute = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/actions",
  operationId: "createAction",
  summary: "Create an action",
  description:
    "Logs something that happened or plans something. Pick the `type`; `payload` holds the type-specific fields. " +
    "Attach it to positions/organizations via `subjects` and to people via `participants`. To also link it to an " +
    "earlier action in one call, use logInteraction. The response may carry stage suggestions for the positions.",
  scope: "project",
  permissions: ["action:create"],
  tags: ["Actions"],
  request: { params: ProjectParams, body: jsonBody(CreateActionSchema) },
  responses: { 201: jsonResponse(ActionMutationSchema, "Created"), ...errorResponses(400, 403, 404) },
});

const updateActionRoute = defineRoute({
  method: "patch",
  path: "/api/projects/{projectId}/actions/{actionId}",
  operationId: "updateAction",
  summary: "Update an action",
  description:
    "Changes fields, e.g. marks a planned action done (`status: done`). `subjects`, `participants` and " +
    "`attachments` replace the current lists when given. To move a planned meeting or interview to another time, " +
    "use rescheduleAction instead. Pass the current `version`.",
  scope: "project",
  permissions: ["action:update"],
  mcp: { expose: true },
  tags: ["Actions"],
  request: { params: ActionParams, body: jsonBody(UpdateActionSchema) },
  responses: { 200: jsonResponse(ActionMutationSchema, "Updated"), ...errorResponses(400, 403, 404, 412, 428) },
});

const rescheduleRoute = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/actions/{actionId}/reschedule",
  operationId: "rescheduleAction",
  summary: "Reschedule a planned action",
  description:
    "Marks the planned action as rescheduled and creates a new planned copy at the new time, linked with a " +
    "`rescheduled` edge so the history stays visible. Returns the new action.",
  scope: "project",
  permissions: ["action:create", "action:update", "edge:create"],
  mcp: { expose: true },
  tags: ["Actions"],
  request: {
    params: ActionParams,
    body: jsonBody(
      z.object({
        scheduledAt: Timestamp.nullable().optional(),
        dueAt: Timestamp.nullable().optional(),
        notes: z.string().max(100_000).nullable().optional(),
        version: VersionField.optional(),
      }),
    ),
  },
  responses: { 201: jsonResponse(ActionSchema, "The new planned action"), ...errorResponses(400, 403, 404, 412, 428) },
});

const deleteActionRoute = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/actions/{actionId}",
  operationId: "deleteAction",
  summary: "Delete an action",
  description: "Soft-deletes an action; it can be restored. Edges to it are hidden while it is deleted.",
  scope: "project",
  permissions: ["action:delete"],
  tags: ["Actions"],
  request: { params: ActionParams, query: z.object({ version: z.coerce.number().int().optional() }) },
  responses: { 204: NoContent, ...errorResponses(403, 404, 412, 428) },
});

const restoreActionRoute = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/actions/{actionId}/restore",
  operationId: "restoreAction",
  summary: "Restore a deleted action",
  description: "Undoes a delete.",
  scope: "project",
  permissions: ["action:delete"],
  tags: ["Actions"],
  request: { params: ActionParams },
  responses: { 204: NoContent, ...errorResponses(403, 404) },
});

/** Actions about an organization: direct subjects plus subjects that are its positions (ADR 0013). */
export function aboutOrganization(orgId: string): SQL {
  return sql`exists (
    select 1 from ${actionSubject} s
    left join ${position} p on p.id = s.position_id
    where s.action_id = ${action.id}
      and (s.organization_id = ${orgId} or p.company_id = ${orgId} or p.agency_id = ${orgId})
  )`;
}

export function aboutPosition(positionId: string): SQL {
  return sql`exists (select 1 from ${actionSubject} s where s.action_id = ${action.id} and s.position_id = ${positionId})`;
}

export function registerActionRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listActions, async (c) => {
    const s = scopeOf(c);
    const q = c.req.valid("query");
    const conditions: (SQL | undefined)[] = [
      eq(action.projectId, s.projectId),
      q.deleted === "true" ? isNotNull(action.deletedAt) : isNull(action.deletedAt),
      cursorCondition(action.id, q.cursor),
    ];
    if (q.type) conditions.push(eq(action.type, q.type));
    if (q.status) conditions.push(eq(action.status, q.status));
    if (q.positionId) conditions.push(aboutPosition(uuidOf("position", q.positionId)));
    if (q.organizationId) conditions.push(aboutOrganization(uuidOf("organization", q.organizationId)));
    if (q.contactId) {
      const contactId = uuidOf("contact", q.contactId);
      conditions.push(
        sql`exists (select 1 from ${actionParticipant} ap where ap.action_id = ${action.id} and ap.contact_id = ${contactId})`,
      );
    }
    if (q.assigneeId) conditions.push(eq(action.assigneeId, uuidOf("user", q.assigneeId)));
    if (q.from) conditions.push(gte(action.scheduledAt, new Date(q.from)));
    if (q.to) conditions.push(lt(action.scheduledAt, new Date(q.to)));
    const tsq = q.q ? prefixQuery(q.q) : null;
    if (tsq) conditions.push(or(sql`${action.search} @@ to_tsquery('simple', ${tsq})`));
    const rows = await s.db
      .select()
      .from(action)
      .where(and(...conditions))
      .orderBy(desc(action.id))
      .limit(q.limit + 1);
    const result = nextCursor(rows, q.limit);
    return c.json({ items: await loadActions(s.db, result.items), nextCursor: result.nextCursor }, 200);
  });

  app.openapi(getAction, async (c) => {
    const s = scopeOf(c);
    const view = await loadAction(s.db, s, uuidOf("action", c.req.valid("param").actionId));
    c.header("ETag", etag(view.version));
    return c.json(view, 200);
  });

  app.openapi(createActionRoute, async (c) => {
    const s = scopeOf(c);
    const result = await s.db.transaction(async (tx) => {
      const { id, suggestions } = await createAction(tx, s, c.req.valid("json"));
      return { action: await loadAction(tx, s, id), suggestions };
    });
    return c.json(result, 201);
  });

  app.openapi(updateActionRoute, async (c) => {
    const s = scopeOf(c);
    const { version, ...input } = c.req.valid("json");
    const id = uuidOf("action", c.req.valid("param").actionId);
    const result = await s.db.transaction(async (tx) => {
      const { suggestions } = await updateAction(tx, s, id, expectedVersion(c, version), input);
      return { action: await loadAction(tx, s, id), suggestions };
    });
    c.header("ETag", etag(result.action.version));
    return c.json(result, 200);
  });

  app.openapi(rescheduleRoute, async (c) => {
    const s = scopeOf(c);
    const { version, ...input } = c.req.valid("json");
    const id = uuidOf("action", c.req.valid("param").actionId);
    const view = await s.db.transaction(async (tx) => {
      const newId = await rescheduleAction(tx, s, id, expectedVersion(c, version), input);
      return loadAction(tx, s, newId);
    });
    return c.json(view, 201);
  });

  app.openapi(deleteActionRoute, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("action", c.req.valid("param").actionId);
    const version = expectedVersion(c, c.req.valid("query").version);
    await s.db.transaction((tx) =>
      softDelete(tx, action, s, { id, expectedVersion: version, entityName: "Action", entityType: "action" }),
    );
    return c.body(null, 204);
  });

  app.openapi(restoreActionRoute, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("action", c.req.valid("param").actionId);
    await s.db.transaction((tx) => restore(tx, action, s, { id, entityName: "Action", entityType: "action" }));
    return c.body(null, 204);
  });
}
