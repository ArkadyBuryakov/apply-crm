// Comments, notifications and audit history (ADR 0012, 0015, 0016).

import {
  action,
  auditEvent,
  comment,
  contact,
  document,
  notification,
  organization,
  position,
  type Tx,
  user,
} from "@crm/db";
import { AUDIT_VIA, COMMENT_TARGETS, type CommentTarget, type IdKind, newUuid, roleHas } from "@crm/shared";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { errorResponses, forbidden, notFound } from "../http/errors.js";
import {
  defineRoute,
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
  withProject,
} from "../http/route.js";
import { scopeOf } from "../http/scope.js";
import { iso, isoOrNull, pid, pidOrNull } from "../http/serialize.js";
import type { AppEnv } from "../http/types.js";
import { audit, cursorCondition, nextCursor, type Scope, visible } from "../services/core.js";

const TARGET_ID_KIND: Record<CommentTarget, IdKind> = {
  organization: "organization",
  position: "position",
  contact: "contact",
  action: "action",
  document: "document",
};

const TARGET_TABLE = { organization, position, contact, action, document } as const;

const CommentTargetSchema = z.enum(COMMENT_TARGETS).openapi("CommentTarget");

const CommentSchema = z
  .object({
    id: publicId("comment"),
    targetType: CommentTargetSchema,
    targetId: z.string().openapi({ description: "Public ID of the commented entity" }),
    authorId: publicId("user").nullable(),
    authorName: z.string().nullable(),
    body: z.string().openapi({ description: "Markdown" }),
    createdAt: Timestamp,
    editedAt: Timestamp.nullable(),
  })
  .openapi("Comment");

const NotificationSchema = z
  .object({
    id: publicId("notification"),
    kind: z.enum(["assigned", "comment"]),
    entityType: z.string(),
    entityId: z.string(),
    message: z.string(),
    createdAt: Timestamp,
    readAt: Timestamp.nullable(),
  })
  .openapi("Notification");

const AuditEventSchema = z
  .object({
    actorId: publicId("user").nullable(),
    actorName: z.string().nullable(),
    via: z.enum(AUDIT_VIA),
    entityType: z.string(),
    entityId: z.string(),
    op: z.string(),
    diff: z.unknown(),
    at: Timestamp,
  })
  .openapi("AuditEvent");

async function resolveTarget(tx: Tx, s: Scope, targetType: CommentTarget, targetId: string) {
  const id = uuidOf(TARGET_ID_KIND[targetType], targetId);
  const table = TARGET_TABLE[targetType];
  const [row] = await tx
    .select({ id: table.id, createdBy: table.createdBy })
    .from(table)
    .where(visible(table, s, id));
  if (!row) throw notFound("Commented entity");
  return row;
}

type CommentRow = typeof comment.$inferSelect;

function commentView(r: CommentRow, authorName: string | null) {
  const kind = TARGET_ID_KIND[r.targetType as CommentTarget];
  return {
    id: pid("comment", r.id),
    targetType: r.targetType as CommentTarget,
    targetId: pid(kind, r.targetId),
    authorId: pidOrNull("user", r.authorId),
    authorName,
    body: r.body,
    createdAt: iso(r.createdAt),
    editedAt: isoOrNull(r.editedAt),
  };
}

const CommentParams = withProject({ commentId: pathId("comment", "commentId") });

const listComments = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/comments",
  operationId: "listComments",
  summary: "List comments on an entity",
  description: "Comments on an organization, position, contact, action or document, oldest first.",
  scope: "project",
  permissions: ["comment:read"],
  mcp: { expose: true },
  tags: ["Comments"],
  request: { params: ProjectParams, query: z.object({ targetType: CommentTargetSchema, targetId: z.string() }) },
  responses: {
    200: jsonResponse(z.object({ items: z.array(CommentSchema) }), "Comments"),
    ...errorResponses(400, 404),
  },
});

const createComment = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/comments",
  operationId: "createComment",
  summary: "Comment on an entity",
  description: "Adds a markdown comment. The entity's creator is notified.",
  scope: "project",
  permissions: ["comment:create"],
  mcp: { expose: true },
  tags: ["Comments"],
  request: {
    params: ProjectParams,
    body: jsonBody(
      z.object({ targetType: CommentTargetSchema, targetId: z.string(), body: z.string().trim().min(1).max(20_000) }),
    ),
  },
  responses: { 201: jsonResponse(CommentSchema, "Created"), ...errorResponses(400, 403, 404) },
});

const editComment = defineRoute({
  method: "patch",
  path: "/api/projects/{projectId}/comments/{commentId}",
  operationId: "editComment",
  summary: "Edit your comment",
  description: "Only the author can edit a comment.",
  scope: "project",
  permissions: ["comment:create"],
  tags: ["Comments"],
  request: { params: CommentParams, body: jsonBody(z.object({ body: z.string().trim().min(1).max(20_000) })) },
  responses: { 200: jsonResponse(CommentSchema, "Updated"), ...errorResponses(403, 404) },
});

const deleteComment = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/comments/{commentId}",
  operationId: "deleteComment",
  summary: "Delete a comment",
  description: "Authors can delete their own comments; the owner can delete any comment.",
  scope: "project",
  permissions: ["comment:read"],
  tags: ["Comments"],
  request: { params: CommentParams },
  responses: { 204: NoContent, ...errorResponses(403, 404) },
});

const listNotifications = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/notifications",
  operationId: "listNotifications",
  summary: "List your notifications",
  description: "Assignments and comments addressed to the caller in this project, newest first.",
  scope: "project",
  permissions: ["project:read"],
  tags: ["Notifications"],
  request: { params: ProjectParams, query: ListQuery.extend({ unread: z.enum(["true", "false"]).optional() }) },
  responses: { 200: jsonResponse(page(NotificationSchema), "Notifications"), ...errorResponses(404) },
});

const markNotificationsRead = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/notifications/read",
  operationId: "markNotificationsRead",
  summary: "Mark notifications as read",
  description: "Marks the given notifications, or all of them when `ids` is omitted.",
  scope: "project",
  permissions: ["project:read"],
  tags: ["Notifications"],
  request: { params: ProjectParams, body: jsonBody(z.object({ ids: z.array(publicId("notification")).optional() })) },
  responses: { 204: NoContent, ...errorResponses(404) },
});

const listAudit = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/audit",
  operationId: "listAuditEvents",
  summary: "Change history",
  description: "Who changed what and when, optionally for one entity. `via` tells web, API key and MCP changes apart.",
  scope: "project",
  permissions: ["audit:read"],
  tags: ["Audit"],
  request: {
    params: ProjectParams,
    query: ListQuery.extend({
      entityType: z.string().max(50).optional(),
      entityId: z.string().max(100).optional().openapi({ description: "Public ID of the entity" }),
    }),
  },
  responses: { 200: jsonResponse(page(AuditEventSchema), "Events"), ...errorResponses(404) },
});

const ENTITY_KIND_BY_PREFIX: Record<string, IdKind> = {
  org: "organization",
  pos: "position",
  con: "contact",
  act: "action",
  chn: "channel",
  stg: "stage",
  doc: "document",
  aff: "affiliation",
  hdl: "handle",
};

export function registerCollaborationRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listComments, async (c) => {
    const s = scopeOf(c);
    const q = c.req.valid("query");
    const target = await resolveTarget(s.db, s, q.targetType, q.targetId);
    const rows = await s.db
      .select({ c: comment, authorName: user.name })
      .from(comment)
      .leftJoin(user, eq(user.id, comment.authorId))
      .where(
        and(
          eq(comment.projectId, s.projectId),
          eq(comment.targetType, q.targetType),
          eq(comment.targetId, target.id),
          isNull(comment.deletedAt),
        ),
      )
      .orderBy(asc(comment.id));
    return c.json({ items: rows.map((r) => commentView(r.c, r.authorName)) }, 200);
  });

  app.openapi(createComment, async (c) => {
    const s = scopeOf(c);
    const body = c.req.valid("json");
    const row = await s.db.transaction(async (tx) => {
      const target = await resolveTarget(tx, s, body.targetType, body.targetId);
      const [created] = await tx
        .insert(comment)
        .values({
          id: newUuid(),
          projectId: s.projectId,
          targetType: body.targetType,
          targetId: target.id,
          authorId: s.actor.userId,
          body: body.body,
        })
        .returning();
      if (target.createdBy && target.createdBy !== s.actor.userId) {
        await tx.insert(notification).values({
          id: newUuid(),
          projectId: s.projectId,
          userId: target.createdBy,
          kind: "comment",
          entityType: body.targetType,
          entityId: target.id,
          message: `${s.actor.name} commented: ${body.body.slice(0, 140)}`,
        });
      }
      await audit(tx, s, {
        entityType: "comment",
        entityId: created!.id,
        op: "create",
        diff: { target: body.targetId },
      });
      return created!;
    });
    return c.json(commentView(row, s.actor.name), 201);
  });

  app.openapi(editComment, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("comment", c.req.valid("param").commentId);
    const [current] = await s.db
      .select()
      .from(comment)
      .where(and(eq(comment.projectId, s.projectId), eq(comment.id, id), isNull(comment.deletedAt)));
    if (!current) throw notFound("Comment");
    if (current.authorId !== s.actor.userId) throw forbidden("Only the author can edit a comment");
    const [row] = await s.db
      .update(comment)
      .set({ body: c.req.valid("json").body, editedAt: new Date() })
      .where(eq(comment.id, id))
      .returning();
    return c.json(commentView(row!, s.actor.name), 200);
  });

  app.openapi(deleteComment, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("comment", c.req.valid("param").commentId);
    const role = c.var.project.role;
    await s.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(comment)
        .where(and(eq(comment.projectId, s.projectId), eq(comment.id, id), isNull(comment.deletedAt)));
      if (!current) throw notFound("Comment");
      const own = current.authorId === s.actor.userId;
      if (!own && !roleHas(role, "comment:moderate")) throw forbidden("You can only delete your own comments");
      await tx.update(comment).set({ deletedAt: new Date() }).where(eq(comment.id, id));
      await audit(tx, s, { entityType: "comment", entityId: id, op: "delete", diff: { moderated: !own } });
    });
    return c.body(null, 204);
  });

  app.openapi(listNotifications, async (c) => {
    const s = scopeOf(c);
    const q = c.req.valid("query");
    const rows = await s.db
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.projectId, s.projectId),
          eq(notification.userId, s.actor.userId),
          q.unread === "true" ? isNull(notification.readAt) : undefined,
          cursorCondition(notification.id, q.cursor),
        ),
      )
      .orderBy(desc(notification.id))
      .limit(q.limit + 1);
    const result = nextCursor(rows, q.limit);
    return c.json(
      {
        items: result.items.map((n) => ({
          id: pid("notification", n.id),
          kind: n.kind as "assigned" | "comment",
          entityType: n.entityType,
          entityId: pid(TARGET_ID_KIND[n.entityType as CommentTarget] ?? "action", n.entityId),
          message: n.message,
          createdAt: iso(n.createdAt),
          readAt: isoOrNull(n.readAt),
        })),
        nextCursor: result.nextCursor,
      },
      200,
    );
  });

  app.openapi(markNotificationsRead, async (c) => {
    const s = scopeOf(c);
    const { ids } = c.req.valid("json");
    await s.db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.projectId, s.projectId),
          eq(notification.userId, s.actor.userId),
          isNull(notification.readAt),
          ids
            ? inArray(
                notification.id,
                ids.map((i) => uuidOf("notification", i)),
              )
            : undefined,
        ),
      );
    return c.body(null, 204);
  });

  app.openapi(listAudit, async (c) => {
    const s = scopeOf(c);
    const q = c.req.valid("query");
    let entityId: string | undefined;
    if (q.entityId) {
      const kind = ENTITY_KIND_BY_PREFIX[q.entityId.split("_")[0] ?? ""];
      entityId = kind ? uuidOf(kind, q.entityId) : q.entityId;
    }
    const rows = await s.db
      .select({ e: auditEvent, actorName: user.name })
      .from(auditEvent)
      .leftJoin(user, eq(user.id, auditEvent.actorUserId))
      .where(
        and(
          eq(auditEvent.projectId, s.projectId),
          q.entityType ? eq(auditEvent.entityType, q.entityType) : undefined,
          entityId ? eq(auditEvent.entityId, entityId) : undefined,
          cursorCondition(auditEvent.id, q.cursor),
        ),
      )
      .orderBy(desc(auditEvent.id))
      .limit(q.limit + 1);
    const result = nextCursor(
      rows.map((r) => ({ ...r, id: r.e.id })),
      q.limit,
    );
    return c.json(
      {
        items: result.items.map(({ e, actorName }) => ({
          actorId: pidOrNull("user", e.actorUserId),
          actorName,
          via: e.via as (typeof AUDIT_VIA)[number],
          entityType: e.entityType,
          entityId: e.entityId,
          op: e.op,
          diff: e.diff,
          at: iso(e.at),
        })),
        nextCursor: result.nextCursor,
      },
      200,
    );
  });
}
