// Composite operations for the UI and MCP (ADR 0018) and project-wide search (ADR 0016).

import {
  action,
  actionParticipant,
  contact,
  contactAffiliation,
  contactHandle,
  document,
  documentVersion,
  organization,
  position,
} from "@crm/db";
import { DOCUMENT_KINDS } from "@crm/shared";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, inArray, max, or, type SQL, sql } from "drizzle-orm";
import { errorResponses, notFound } from "../http/errors.js";
import {
  defineRoute,
  jsonBody,
  jsonResponse,
  ProjectParams,
  pathId,
  publicId,
  Timestamp,
  uuidOf,
  withProject,
} from "../http/route.js";
import { scopeOf } from "../http/scope.js";
import { iso, pid } from "../http/serialize.js";
import type { AppEnv } from "../http/types.js";
import { createAction, loadAction, loadActions } from "../services/actions.js";
import { visible } from "../services/core.js";
import { addEdge, edgesAmong } from "../services/graph.js";
import { prefixQuery } from "../services/search.js";
import { ActionSchema, aboutPosition, CreateActionSchema, SuggestionSchema } from "./actions.js";
import { ContactSchema, loadContacts } from "./contacts.js";
import { EdgeKindSchema, EdgeSchema } from "./graph.js";
import { OrganizationSchema, organizationView } from "./organizations.js";
import { loadPosition, PositionSchema } from "./positions.js";

const TIMELINE_LIMIT = 200;
const CONTACT_LIMIT = 100;

const DocumentRefSchema = z
  .object({
    id: publicId("document"),
    kind: z.enum(DOCUMENT_KINDS),
    title: z.string(),
    latestVersionNo: z.int().nullable(),
    updatedAt: Timestamp,
  })
  .openapi("DocumentRef");

const OverviewSchema = z
  .object({
    position: PositionSchema,
    company: OrganizationSchema.nullable(),
    agency: OrganizationSchema.nullable(),
    contacts: z.array(ContactSchema).openapi({
      description: "People involved in the position's actions plus people currently at its company or agency",
    }),
    timeline: z
      .array(ActionSchema)
      .openapi({ description: `Actions about the position, newest first (max ${TIMELINE_LIMIT})` }),
    edges: z.array(EdgeSchema).openapi({ description: "Edges between timeline actions" }),
    documents: z.array(DocumentRefSchema).openapi({ description: "Documents tailored for this position" }),
  })
  .openapi("PositionOverview");

const overviewRoute = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/positions/{positionId}/overview",
  operationId: "getPositionOverview",
  summary: "Everything about a position in one call",
  description:
    "The position with its company and agency, the people involved, the action timeline with links between actions, " +
    "and tailored documents. Start here before working on a position.",
  scope: "project",
  permissions: ["position:read", "action:read", "contact:read", "organization_entity:read", "document:read"],
  mcp: { expose: true },
  tags: ["Composite"],
  request: { params: withProject({ positionId: pathId("position", "positionId") }) },
  responses: { 200: jsonResponse(OverviewSchema, "Overview"), ...errorResponses(404) },
});

const AgendaSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    timezone: z.string(),
    overdue: z
      .array(ActionSchema)
      .openapi({ description: "Planned actions due (or, without a due date, scheduled) before today" }),
    today: z
      .array(ActionSchema)
      .openapi({ description: "Planned actions that start on or before today and are due today or later" }),
    upcoming: z
      .array(ActionSchema)
      .openapi({ description: "Planned actions starting after today, on a day in the range" }),
  })
  .openapi("Agenda");

const agendaRoute = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/agenda",
  operationId: "getAgenda",
  summary: "What is planned and overdue",
  description:
    "Planned actions by day in the caller's timezone. An action starts on its scheduled day and is due on its due " +
    "day; with only one of the two, both are that day. `overdue`: due before today. `today`: started and not yet " +
    "due before today. `upcoming`: starting after today, between `from` and `to` (inclusive dates; default: today " +
    "and the next 6 days). `overdue` and `today` are sorted by due date, `upcoming` by start date. Optionally only " +
    "one assignee's actions.",
  scope: "project",
  permissions: ["action:read"],
  mcp: { expose: true },
  tags: ["Composite"],
  request: {
    params: ProjectParams,
    query: z.object({
      from: z.iso.date().optional(),
      to: z.iso.date().optional(),
      assigneeId: publicId("user").optional(),
    }),
  },
  responses: { 200: jsonResponse(AgendaSchema, "Agenda"), ...errorResponses(404) },
});

const logInteractionRoute = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/log-interaction",
  operationId: "logInteraction",
  summary: "Log an action and link it to the previous one",
  description:
    "Creates an action (same body as createAction under `action`) and, when `previousActionId` is given, links " +
    "previous → new with `edgeKind` (default follow_up), all in one transaction. The usual way to record what " +
    "just happened, e.g. the interview that followed a screening call.",
  scope: "project",
  permissions: ["action:create", "edge:create"],
  mcp: { expose: true },
  tags: ["Composite"],
  request: {
    params: ProjectParams,
    body: jsonBody(
      z.object({
        action: CreateActionSchema,
        previousActionId: publicId("action").optional(),
        edgeKind: EdgeKindSchema.default("follow_up"),
        edgeNote: z.string().max(2000).optional(),
      }),
    ),
  },
  responses: {
    201: jsonResponse(
      z
        .object({
          action: ActionSchema,
          edge: EdgeSchema.nullable(),
          warnings: z.array(z.literal("cycle")),
          suggestions: z.array(SuggestionSchema),
        })
        .openapi("LoggedInteraction"),
      "Logged",
    ),
    ...errorResponses(400, 403, 404),
  },
});

const SearchHitSchema = z
  .object({
    type: z.enum(["organization", "position", "contact", "action"]),
    id: z.string(),
    title: z.string(),
    subtitle: z.string().nullable(),
  })
  .openapi("SearchHit");

const searchRoute = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/search",
  operationId: "search",
  summary: "Search across the project",
  description:
    "Finds organizations, positions, contacts (also by email or handle) and actions by text. Prefix matching.",
  scope: "project",
  permissions: ["organization_entity:read", "position:read", "contact:read", "action:read"],
  mcp: { expose: true },
  tags: ["Composite"],
  request: {
    params: ProjectParams,
    query: z.object({
      q: z.string().trim().min(1).max(200),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  },
  responses: { 200: jsonResponse(z.object({ items: z.array(SearchHitSchema) }), "Hits"), ...errorResponses(404) },
});

export function registerCompositeRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(overviewRoute, async (c) => {
    const s = scopeOf(c);
    const positionId = uuidOf("position", c.req.valid("param").positionId);
    const view = await loadPosition(s.db, s, positionId);
    const [pos] = await s.db.select().from(position).where(eq(position.id, positionId));
    if (!pos) throw notFound("Position");

    const orgIds = [pos.companyId, pos.agencyId].filter((x): x is string => Boolean(x));
    const orgs = orgIds.length ? await s.db.select().from(organization).where(inArray(organization.id, orgIds)) : [];
    const companyRow = orgs.find((o) => o.id === pos.companyId);
    const agencyRow = orgs.find((o) => o.id === pos.agencyId);

    const timelineRows = await s.db
      .select()
      .from(action)
      .where(and(visible(action, s), aboutPosition(positionId)))
      .orderBy(desc(sql`coalesce(${action.completedAt}, ${action.scheduledAt}, ${action.dueAt}, ${action.createdAt})`))
      .limit(TIMELINE_LIMIT);
    const timelineIds = timelineRows.map((r) => r.id);

    const contactConditions = [
      timelineIds.length
        ? sql`${contact.id} in (select ${actionParticipant.contactId} from ${actionParticipant} where ${inArray(actionParticipant.actionId, timelineIds)})`
        : undefined,
      orgIds.length
        ? sql`${contact.id} in (select ${contactAffiliation.contactId} from ${contactAffiliation} where ${contactAffiliation.deletedAt} is null and ${inArray(contactAffiliation.organizationId, orgIds)} and (${contactAffiliation.toDate} is null or ${contactAffiliation.toDate} >= current_date))`
        : undefined,
    ].filter(Boolean);
    const contactRows = contactConditions.length
      ? await s.db
          .select()
          .from(contact)
          .where(and(visible(contact, s), or(...contactConditions)))
          .orderBy(asc(contact.name))
          .limit(CONTACT_LIMIT)
      : [];

    const docs = await s.db
      .select({
        id: document.id,
        kind: document.kind,
        title: document.title,
        updatedAt: document.updatedAt,
        latestVersionNo: max(documentVersion.versionNo),
      })
      .from(document)
      .leftJoin(documentVersion, eq(documentVersion.documentId, document.id))
      .where(and(visible(document, s), eq(document.positionId, positionId)))
      .groupBy(document.id)
      .orderBy(asc(document.title));

    return c.json(
      {
        position: view,
        company: companyRow ? organizationView(companyRow) : null,
        agency: agencyRow ? organizationView(agencyRow) : null,
        contacts: await loadContacts(s.db, contactRows),
        timeline: await loadActions(s.db, timelineRows),
        edges: await edgesAmong(s.db, s, timelineIds),
        documents: docs.map((d) => ({
          id: pid("document", d.id),
          kind: d.kind as (typeof DOCUMENT_KINDS)[number],
          title: d.title,
          latestVersionNo: d.latestVersionNo,
          updatedAt: iso(d.updatedAt),
        })),
      },
      200,
    );
  });

  app.openapi(agendaRoute, async (c) => {
    const s = scopeOf(c);
    const q = c.req.valid("query");
    const tz = s.actor.timezone;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    const from = q.from ?? today;
    const to = q.to ?? addDays(from, 6);
    const assignee = q.assigneeId ? eq(action.assigneeId, uuidOf("user", q.assigneeId)) : undefined;
    const planned = and(visible(action, s), eq(action.status, "planned"), assignee);
    const start = sql`coalesce(${action.scheduledAt}, ${action.dueAt})`;
    const due = sql`coalesce(${action.dueAt}, ${action.scheduledAt})`;
    const startDay = sql`(${start} at time zone ${tz})::date`;
    const dueDay = sql`(${due} at time zone ${tz})::date`;
    const day = (d: string) => sql`${d}::date`;
    const list = (where: SQL | undefined, orderBy: SQL, limit: number) =>
      s.db.select().from(action).where(and(planned, where)).orderBy(asc(orderBy)).limit(limit);

    // Overdue and today are sorted by when they are due; upcoming by when they start.
    const [overdueRows, todayRows, upcomingRows] = await Promise.all([
      list(sql`${dueDay} < ${day(today)}`, due, 200),
      list(and(sql`${startDay} <= ${day(today)}`, sql`${dueDay} >= ${day(today)}`), due, 200),
      list(
        and(sql`${startDay} > ${day(today)}`, sql`${startDay} >= ${day(from)}`, sql`${startDay} <= ${day(to)}`),
        start,
        500,
      ),
    ]);
    return c.json(
      {
        from,
        to,
        timezone: tz,
        overdue: await loadActions(s.db, overdueRows),
        today: await loadActions(s.db, todayRows),
        upcoming: await loadActions(s.db, upcomingRows),
      },
      200,
    );
  });

  app.openapi(logInteractionRoute, async (c) => {
    const s = scopeOf(c);
    const body = c.req.valid("json");
    const result = await s.db.transaction(async (tx) => {
      const { id, suggestions } = await createAction(tx, s, body.action);
      let edge = null;
      let warnings: "cycle"[] = [];
      if (body.previousActionId) {
        const linked = await addEdge(tx, s, {
          parentId: uuidOf("action", body.previousActionId),
          childId: id,
          kind: body.edgeKind,
          note: body.edgeNote,
        });
        edge = linked.edge;
        warnings = linked.warnings as "cycle"[];
      }
      return { action: await loadAction(tx, s, id), edge, warnings, suggestions };
    });
    return c.json(result, 201);
  });

  app.openapi(searchRoute, async (c) => {
    const s = scopeOf(c);
    const { q, limit } = c.req.valid("query");
    const tsq = prefixQuery(q);
    const like = `%${q}%`;
    const matches = (col: unknown) => (tsq ? sql`${col} @@ to_tsquery('simple', ${tsq})` : sql`false`);
    const rank = (col: unknown) => (tsq ? sql<number>`ts_rank(${col}, to_tsquery('simple', ${tsq}))` : sql<number>`0`);

    const [orgs, positions, contacts, actions] = await Promise.all([
      s.db
        .select({
          id: organization.id,
          title: organization.name,
          subtitle: organization.kind,
          rank: rank(organization.search),
        })
        .from(organization)
        .where(and(visible(organization, s), matches(organization.search)))
        .limit(limit),
      s.db
        .select({ id: position.id, title: position.title, subtitle: organization.name, rank: rank(position.search) })
        .from(position)
        .leftJoin(organization, eq(organization.id, position.companyId))
        .where(and(visible(position, s), matches(position.search)))
        .limit(limit),
      s.db
        .select({ id: contact.id, title: contact.name, subtitle: sql<string | null>`null`, rank: rank(contact.search) })
        .from(contact)
        .where(
          and(
            visible(contact, s),
            or(
              matches(contact.search),
              sql`exists (select 1 from ${contactHandle} h where h.contact_id = ${contact.id} and h.deleted_at is null and h.value ilike ${like})`,
            ),
          ),
        )
        .limit(limit),
      s.db
        .select({ id: action.id, title: action.title, subtitle: action.type, rank: rank(action.search) })
        .from(action)
        .where(and(visible(action, s), matches(action.search)))
        .limit(limit),
    ]);
    const hits = [
      ...orgs.map((r) => ({ ...r, type: "organization" as const, id: pid("organization", r.id) })),
      ...positions.map((r) => ({ ...r, type: "position" as const, id: pid("position", r.id) })),
      ...contacts.map((r) => ({ ...r, type: "contact" as const, id: pid("contact", r.id) })),
      ...actions.map((r) => ({ ...r, type: "action" as const, id: pid("action", r.id) })),
    ]
      .sort((a, b) => Number(b.rank) - Number(a.rank))
      .slice(0, limit)
      .map(({ rank: _rank, ...hit }) => ({ ...hit, subtitle: hit.subtitle ?? null }));
    return c.json({ items: hits }, 200);
  });
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
