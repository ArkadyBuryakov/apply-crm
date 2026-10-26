// Organizations: companies and agencies in one table (ADR 0002).

import { organization } from "@crm/db";
import { newUuid, ORGANIZATION_KINDS } from "@crm/shared";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq, isNotNull, type SQL, sql } from "drizzle-orm";
import { errorResponses, notFound } from "../http/errors.js";
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
import { iso, pid } from "../http/serialize.js";
import type { AppEnv } from "../http/types.js";
import { audit, cursorCondition, nextCursor, restore, softDelete, updateVersioned, visible } from "../services/core.js";
import { prefixQuery } from "../services/search.js";

export const OrganizationKindSchema = z.enum(ORGANIZATION_KINDS).openapi("OrganizationKind");

export const OrganizationSchema = z
  .object({
    id: publicId("organization"),
    kind: OrganizationKindSchema,
    name: z.string(),
    website: z.string().nullable(),
    notes: z.string().nullable(),
    version: z.int(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    deletedAt: Timestamp.nullable(),
  })
  .openapi("Organization");

const OrganizationInput = z.object({
  kind: OrganizationKindSchema,
  name: z.string().trim().min(1).max(300),
  website: z.url().max(2000).nullable().optional(),
  notes: z.string().max(100_000).nullable().optional(),
});

type OrganizationRow = typeof organization.$inferSelect;

export const organizationView = (r: OrganizationRow) => ({
  id: pid("organization", r.id),
  kind: r.kind as (typeof ORGANIZATION_KINDS)[number],
  name: r.name,
  website: r.website,
  notes: r.notes,
  version: r.version,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
  deletedAt: r.deletedAt ? iso(r.deletedAt) : null,
});

const OrgParams = withProject({ organizationId: pathId("organization", "organizationId") });

const listOrganizations = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/organizations",
  operationId: "listOrganizations",
  summary: "List or search organizations",
  description:
    "Companies you apply to and recruiting agencies. Filter by `kind` and search by name with `q` (prefix match). " +
    "Search before creating to avoid duplicates.",
  scope: "project",
  permissions: ["organization_entity:read"],
  mcp: { expose: true },
  tags: ["Organizations"],
  request: {
    params: ProjectParams,
    query: ListQuery.extend({
      kind: OrganizationKindSchema.optional(),
      q: z.string().max(200).optional().openapi({ description: "Search text" }),
      deleted: z
        .enum(["true", "false"])
        .optional()
        .openapi({ description: "List deleted organizations instead (for restoring)" }),
    }),
  },
  responses: { 200: jsonResponse(page(OrganizationSchema), "Organizations"), ...errorResponses(404) },
});

const getOrganization = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/organizations/{organizationId}",
  operationId: "getOrganization",
  summary: "Get an organization",
  description: "Returns one organization.",
  scope: "project",
  permissions: ["organization_entity:read"],
  mcp: { expose: true },
  tags: ["Organizations"],
  request: { params: OrgParams },
  responses: { 200: jsonResponse(OrganizationSchema, "Organization"), ...errorResponses(404) },
});

const createOrganization = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/organizations",
  operationId: "createOrganization",
  summary: "Create an organization",
  description: "Adds a company (an employer) or an agency (a recruiting intermediary).",
  scope: "project",
  permissions: ["organization_entity:create"],
  mcp: { expose: true },
  tags: ["Organizations"],
  request: { params: ProjectParams, body: jsonBody(OrganizationInput) },
  responses: { 201: jsonResponse(OrganizationSchema, "Created"), ...errorResponses(403, 404) },
});

const updateOrganization = defineRoute({
  method: "patch",
  path: "/api/projects/{projectId}/organizations/{organizationId}",
  operationId: "updateOrganization",
  summary: "Update an organization",
  description: "Changes fields of an organization. Pass the current `version`.",
  scope: "project",
  permissions: ["organization_entity:update"],
  mcp: { expose: true },
  tags: ["Organizations"],
  request: {
    params: OrgParams,
    body: jsonBody(OrganizationInput.partial().extend({ version: VersionField.optional() })),
  },
  responses: { 200: jsonResponse(OrganizationSchema, "Updated"), ...errorResponses(403, 404, 412, 428) },
});

const deleteOrganization = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/organizations/{organizationId}",
  operationId: "deleteOrganization",
  summary: "Delete an organization",
  description: "Soft-deletes an organization; it can be restored.",
  scope: "project",
  permissions: ["organization_entity:delete"],
  tags: ["Organizations"],
  request: { params: OrgParams, query: z.object({ version: z.coerce.number().int().optional() }) },
  responses: { 204: NoContent, ...errorResponses(403, 404, 412, 428) },
});

const restoreOrganization = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/organizations/{organizationId}/restore",
  operationId: "restoreOrganization",
  summary: "Restore a deleted organization",
  description: "Undoes a delete.",
  scope: "project",
  permissions: ["organization_entity:delete"],
  tags: ["Organizations"],
  request: { params: OrgParams },
  responses: { 204: NoContent, ...errorResponses(403, 404) },
});

export function registerOrganizationRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listOrganizations, async (c) => {
    const s = scopeOf(c);
    const q = c.req.valid("query");
    const conditions: (SQL | undefined)[] = [
      eq(organization.projectId, s.projectId),
      q.deleted === "true" ? isNotNull(organization.deletedAt) : sql`${organization.deletedAt} is null`,
      cursorCondition(organization.id, q.cursor),
    ];
    if (q.kind) conditions.push(eq(organization.kind, q.kind));
    const tsq = q.q ? prefixQuery(q.q) : null;
    if (tsq) conditions.push(sql`${organization.search} @@ to_tsquery('simple', ${tsq})`);
    const rows = await s.db
      .select()
      .from(organization)
      .where(and(...conditions))
      .orderBy(desc(organization.id))
      .limit(q.limit + 1);
    const result = nextCursor(rows, q.limit);
    return c.json({ items: result.items.map(organizationView), nextCursor: result.nextCursor }, 200);
  });

  app.openapi(getOrganization, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("organization", c.req.valid("param").organizationId);
    const [row] = await s.db
      .select()
      .from(organization)
      .where(visible(organization, s, id));
    if (!row) throw notFound("Organization");
    c.header("ETag", etag(row.version));
    return c.json(organizationView(row), 200);
  });

  app.openapi(createOrganization, async (c) => {
    const s = scopeOf(c);
    const body = c.req.valid("json");
    const row = await s.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(organization)
        .values({
          id: newUuid(),
          projectId: s.projectId,
          kind: body.kind,
          name: body.name,
          website: body.website ?? null,
          notes: body.notes ?? null,
          createdBy: s.actor.userId,
        })
        .returning();
      await audit(tx, s, { entityType: "organization", entityId: created!.id, op: "create", diff: { after: body } });
      return created!;
    });
    return c.json(organizationView(row), 201);
  });

  app.openapi(updateOrganization, async (c) => {
    const s = scopeOf(c);
    const { version, ...set } = c.req.valid("json");
    const id = uuidOf("organization", c.req.valid("param").organizationId);
    const row = await s.db.transaction(async (tx) => {
      const { before, after } = await updateVersioned<typeof organization, OrganizationRow>(tx, organization, s, {
        id,
        expectedVersion: expectedVersion(c, version),
        set,
        entityName: "Organization",
      });
      await audit(tx, s, { entityType: "organization", entityId: id, op: "update", diff: diffOf(before, set) });
      return after;
    });
    c.header("ETag", etag(row.version));
    return c.json(organizationView(row), 200);
  });

  app.openapi(deleteOrganization, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("organization", c.req.valid("param").organizationId);
    const version = expectedVersion(c, c.req.valid("query").version);
    await s.db.transaction((tx) =>
      softDelete(tx, organization, s, {
        id,
        expectedVersion: version,
        entityName: "Organization",
        entityType: "organization",
      }),
    );
    return c.body(null, 204);
  });

  app.openapi(restoreOrganization, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("organization", c.req.valid("param").organizationId);
    await s.db.transaction((tx) =>
      restore(tx, organization, s, { id, entityName: "Organization", entityType: "organization" }),
    );
    return c.body(null, 204);
  });
}

/** Audit diff of a PATCH: previous and new values of the fields that were sent. */
export function diffOf(before: Record<string, unknown>, set: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(set).map((k) => [k, { from: before[k] ?? null, to: set[k] ?? null }]));
}
