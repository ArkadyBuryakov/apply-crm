// Positions: the job openings being pursued (ADR 0002, 0014, 0026).

import { channel, organization, position, positionStage, type Tx } from "@crm/db";
import { newUuid, POSITION_OUTCOMES, SALARY_PERIODS } from "@crm/shared";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { badRequest, errorResponses, notFound } from "../http/errors.js";
import {
  defineRoute,
  etag,
  expectedVersion,
  jsonBody,
  jsonResponse,
  ListQuery,
  NoContent,
  optionalUuidOf,
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
import { iso, pid, pidOrNull } from "../http/serialize.js";
import type { AppEnv } from "../http/types.js";
import {
  audit,
  cursorCondition,
  nextCursor,
  requireVisible,
  restore,
  type Scope,
  softDelete,
  updateVersioned,
  visible,
} from "../services/core.js";
import { prefixQuery } from "../services/search.js";
import { diffOf } from "./organizations.js";

const OutcomeSchema = z
  .enum(POSITION_OUTCOMES)
  .openapi("PositionOutcome", { description: "`open` while in progress; anything else is a terminal result" });

const SalarySchema = z
  .object({
    min: z.number().nonnegative().nullable(),
    max: z.number().nonnegative().nullable(),
    currency: z.string().length(3).nullable().openapi({ description: "ISO 4217, e.g. EUR" }),
    period: z.enum(SALARY_PERIODS).nullable(),
  })
  .openapi("Salary");

const OrgRef = z.object({ id: publicId("organization"), name: z.string() }).openapi("OrganizationRef");

export const PositionSchema = z
  .object({
    id: publicId("position"),
    title: z.string(),
    company: OrgRef.nullable().openapi({ description: "Employer; empty while an agency keeps the client undisclosed" }),
    agency: OrgRef.nullable(),
    url: z.string().nullable().openapi({ description: "Listing URL" }),
    descriptionMarkdown: z.string().nullable().openapi({ description: "Snapshot of the listing text" }),
    salary: SalarySchema,
    stageId: publicId("stage"),
    stageKey: z.string(),
    outcome: OutcomeSchema,
    sourceChannelId: publicId("channel").nullable(),
    notes: z.string().nullable(),
    version: z.int(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    deletedAt: Timestamp.nullable(),
  })
  .openapi("Position");

const PositionInput = z.object({
  title: z.string().trim().min(1).max(300),
  companyId: publicId("organization").nullable().optional().openapi({ description: "An organization of kind company" }),
  agencyId: publicId("organization").nullable().optional().openapi({ description: "An organization of kind agency" }),
  url: z.url().max(2000).nullable().optional(),
  descriptionMarkdown: z
    .string()
    .max(200_000)
    .nullable()
    .optional()
    .openapi({ description: "Paste the listing text; the server never fetches URLs" }),
  salary: SalarySchema.partial().nullable().optional(),
  stageId: publicId("stage").optional().openapi({ description: "Defaults to the first stage" }),
  outcome: OutcomeSchema.optional(),
  sourceChannelId: publicId("channel").nullable().optional(),
  notes: z.string().max(100_000).nullable().optional(),
});

const PositionParams = withProject({ positionId: pathId("position", "positionId") });

type PositionRow = typeof position.$inferSelect;

const company = alias(organization, "company");
const agency = alias(organization, "agency");

export async function loadPositions(
  tx: Tx,
  where: SQL,
  opts: { limit?: number; order?: "id_desc" | "updated_desc" } = {},
) {
  const query = tx
    .select({
      p: position,
      stageKey: positionStage.key,
      companyName: company.name,
      agencyName: agency.name,
    })
    .from(position)
    .innerJoin(positionStage, eq(positionStage.id, position.stageId))
    .leftJoin(company, eq(company.id, position.companyId))
    .leftJoin(agency, eq(agency.id, position.agencyId))
    .where(where)
    .orderBy(opts.order === "updated_desc" ? desc(position.updatedAt) : desc(position.id));
  const rows = opts.limit ? await query.limit(opts.limit) : await query;
  return rows.map((r) => ({ id: r.p.id, view: positionView(r.p, r.stageKey, r.companyName, r.agencyName) }));
}

export function positionView(p: PositionRow, stageKey: string, companyName: string | null, agencyName: string | null) {
  return {
    id: pid("position", p.id),
    title: p.title,
    company: p.companyId ? { id: pid("organization", p.companyId), name: companyName ?? "" } : null,
    agency: p.agencyId ? { id: pid("organization", p.agencyId), name: agencyName ?? "" } : null,
    url: p.url,
    descriptionMarkdown: p.descriptionMarkdown,
    salary: {
      min: p.salaryMin,
      max: p.salaryMax,
      currency: p.salaryCurrency,
      period: p.salaryPeriod as (typeof SALARY_PERIODS)[number] | null,
    },
    stageId: pid("stage", p.stageId),
    stageKey,
    outcome: p.outcome as (typeof POSITION_OUTCOMES)[number],
    sourceChannelId: pidOrNull("channel", p.sourceChannelId),
    notes: p.notes,
    version: p.version,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
    deletedAt: p.deletedAt ? iso(p.deletedAt) : null,
  };
}

export async function loadPosition(tx: Tx, s: Scope, id: string) {
  const [row] = await loadPositions(tx, visible(position, s, id));
  if (!row) throw notFound("Position");
  return row.view;
}

async function requireOrgOfKind(tx: Tx, s: Scope, id: string, kind: "company" | "agency") {
  const [row] = await tx
    .select({ kind: organization.kind })
    .from(organization)
    .where(visible(organization, s, id));
  if (!row) throw notFound(kind === "company" ? "Company" : "Agency");
  if (row.kind !== kind) throw badRequest(`Organization is a ${row.kind}, expected a ${kind}`);
}

/** Converts API input into column values, validating references. Only keys present in the input are returned. */
async function toColumns(tx: Tx, s: Scope, input: Partial<z.infer<typeof PositionInput>>) {
  const set: Partial<typeof position.$inferInsert> = {};
  if (input.title !== undefined) set.title = input.title;
  if (input.companyId !== undefined) {
    set.companyId = optionalUuidOf("organization", input.companyId) ?? null;
    if (set.companyId) await requireOrgOfKind(tx, s, set.companyId, "company");
  }
  if (input.agencyId !== undefined) {
    set.agencyId = optionalUuidOf("organization", input.agencyId) ?? null;
    if (set.agencyId) await requireOrgOfKind(tx, s, set.agencyId, "agency");
  }
  if (input.url !== undefined) set.url = input.url;
  if (input.descriptionMarkdown !== undefined) set.descriptionMarkdown = input.descriptionMarkdown;
  if (input.salary !== undefined) {
    set.salaryMin = input.salary?.min ?? null;
    set.salaryMax = input.salary?.max ?? null;
    set.salaryCurrency = input.salary?.currency?.toUpperCase() ?? null;
    set.salaryPeriod = input.salary?.period ?? null;
  }
  if (input.stageId !== undefined) {
    set.stageId = uuidOf("stage", input.stageId);
    await requireVisible(tx, positionStage, s, set.stageId, "Stage");
  }
  if (input.outcome !== undefined) set.outcome = input.outcome;
  if (input.sourceChannelId !== undefined) {
    set.sourceChannelId = optionalUuidOf("channel", input.sourceChannelId) ?? null;
    if (set.sourceChannelId) await requireVisible(tx, channel, s, set.sourceChannelId, "Channel");
  }
  if (input.notes !== undefined) set.notes = input.notes;
  return set;
}

const listPositions = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/positions",
  operationId: "listPositions",
  summary: "List or search positions",
  description:
    "Job openings in the pipeline. Filter by stage, outcome or organization (as company or agency); `q` searches " +
    "title, listing text and notes. Defaults to all outcomes; pass `outcome=open` for the active pipeline.",
  scope: "project",
  permissions: ["position:read"],
  mcp: { expose: true },
  tags: ["Positions"],
  request: {
    params: ProjectParams,
    query: ListQuery.extend({
      q: z.string().max(200).optional(),
      stageId: publicId("stage").optional(),
      outcome: OutcomeSchema.optional(),
      organizationId: publicId("organization").optional(),
      deleted: z.enum(["true", "false"]).optional(),
    }),
  },
  responses: { 200: jsonResponse(page(PositionSchema), "Positions"), ...errorResponses(404) },
});

const getPosition = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/positions/{positionId}",
  operationId: "getPosition",
  summary: "Get a position",
  description: "Returns one position. getPositionOverview also includes its contacts, timeline and documents.",
  scope: "project",
  permissions: ["position:read"],
  tags: ["Positions"],
  request: { params: PositionParams },
  responses: { 200: jsonResponse(PositionSchema, "Position"), ...errorResponses(404) },
});

const createPosition = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/positions",
  operationId: "createPosition",
  summary: "Create a position",
  description:
    "Adds a job opening. Link the employer as `companyId` and/or the recruiting agency as `agencyId`; both are " +
    "optional because agencies often keep the client undisclosed at first.",
  scope: "project",
  permissions: ["position:create"],
  mcp: { expose: true },
  tags: ["Positions"],
  request: { params: ProjectParams, body: jsonBody(PositionInput) },
  responses: { 201: jsonResponse(PositionSchema, "Created"), ...errorResponses(400, 403, 404) },
});

const updatePosition = defineRoute({
  method: "patch",
  path: "/api/projects/{projectId}/positions/{positionId}",
  operationId: "updatePosition",
  summary: "Update a position",
  description:
    "Changes fields of a position, including moving it to another stage (`stageId`) or recording the result " +
    "(`outcome`). Pass the current `version`.",
  scope: "project",
  permissions: ["position:update"],
  mcp: { expose: true },
  tags: ["Positions"],
  request: {
    params: PositionParams,
    body: jsonBody(PositionInput.partial().extend({ version: VersionField.optional() })),
  },
  responses: { 200: jsonResponse(PositionSchema, "Updated"), ...errorResponses(400, 403, 404, 412, 428) },
});

const deletePosition = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/positions/{positionId}",
  operationId: "deletePosition",
  summary: "Delete a position",
  description: "Soft-deletes a position; it can be restored.",
  scope: "project",
  permissions: ["position:delete"],
  tags: ["Positions"],
  request: { params: PositionParams, query: z.object({ version: z.coerce.number().int().optional() }) },
  responses: { 204: NoContent, ...errorResponses(403, 404, 412, 428) },
});

const restorePosition = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/positions/{positionId}/restore",
  operationId: "restorePosition",
  summary: "Restore a deleted position",
  description: "Undoes a delete.",
  scope: "project",
  permissions: ["position:delete"],
  tags: ["Positions"],
  request: { params: PositionParams },
  responses: { 204: NoContent, ...errorResponses(403, 404) },
});

export function registerPositionRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listPositions, async (c) => {
    const s = scopeOf(c);
    const q = c.req.valid("query");
    const conditions: (SQL | undefined)[] = [
      eq(position.projectId, s.projectId),
      q.deleted === "true" ? isNotNull(position.deletedAt) : isNull(position.deletedAt),
      cursorCondition(position.id, q.cursor),
    ];
    if (q.stageId) conditions.push(eq(position.stageId, uuidOf("stage", q.stageId)));
    if (q.outcome) conditions.push(eq(position.outcome, q.outcome));
    if (q.organizationId) {
      const orgId = uuidOf("organization", q.organizationId);
      conditions.push(or(eq(position.companyId, orgId), eq(position.agencyId, orgId)));
    }
    const tsq = q.q ? prefixQuery(q.q) : null;
    if (tsq) conditions.push(sql`${position.search} @@ to_tsquery('simple', ${tsq})`);
    const rows = await loadPositions(s.db, and(...conditions)!, { limit: q.limit + 1 });
    const result = nextCursor(rows, q.limit);
    return c.json({ items: result.items.map((r) => r.view), nextCursor: result.nextCursor }, 200);
  });

  app.openapi(getPosition, async (c) => {
    const s = scopeOf(c);
    const view = await loadPosition(s.db, s, uuidOf("position", c.req.valid("param").positionId));
    c.header("ETag", etag(view.version));
    return c.json(view, 200);
  });

  app.openapi(createPosition, async (c) => {
    const s = scopeOf(c);
    const body = c.req.valid("json");
    const view = await s.db.transaction(async (tx) => {
      const columns = await toColumns(tx, s, body);
      if (!columns.stageId) {
        const [first] = await tx
          .select({ id: positionStage.id })
          .from(positionStage)
          .where(visible(positionStage, s))
          .orderBy(asc(positionStage.order))
          .limit(1);
        if (!first) throw badRequest("The project has no pipeline stages");
        columns.stageId = first.id;
      }
      const id = newUuid();
      await tx.insert(position).values({
        ...columns,
        id,
        projectId: s.projectId,
        title: body.title,
        stageId: columns.stageId,
        createdBy: s.actor.userId,
      });
      await audit(tx, s, { entityType: "position", entityId: id, op: "create", diff: { after: body } });
      return loadPosition(tx, s, id);
    });
    return c.json(view, 201);
  });

  app.openapi(updatePosition, async (c) => {
    const s = scopeOf(c);
    const { version, ...input } = c.req.valid("json");
    const id = uuidOf("position", c.req.valid("param").positionId);
    const view = await s.db.transaction(async (tx) => {
      const set = await toColumns(tx, s, input);
      const { before } = await updateVersioned<typeof position, PositionRow>(tx, position, s, {
        id,
        expectedVersion: expectedVersion(c, version),
        set,
        entityName: "Position",
      });
      await audit(tx, s, { entityType: "position", entityId: id, op: "update", diff: diffOf(before, set) });
      return loadPosition(tx, s, id);
    });
    c.header("ETag", etag(view.version));
    return c.json(view, 200);
  });

  app.openapi(deletePosition, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("position", c.req.valid("param").positionId);
    const version = expectedVersion(c, c.req.valid("query").version);
    await s.db.transaction((tx) =>
      softDelete(tx, position, s, { id, expectedVersion: version, entityName: "Position", entityType: "position" }),
    );
    return c.body(null, 204);
  });

  app.openapi(restorePosition, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("position", c.req.valid("param").positionId);
    await s.db.transaction((tx) => restore(tx, position, s, { id, entityName: "Position", entityType: "position" }));
    return c.body(null, 204);
  });
}
