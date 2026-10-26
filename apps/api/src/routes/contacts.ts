// Contacts with employment history and per-channel handles (ADR 0002); hard purge for personal data (ADR 0017).

import { auditEvent, channel, contact, contactAffiliation, contactHandle, organization, type Tx } from "@crm/db";
import { newUuid } from "@crm/shared";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
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
import { dateOrNull, iso, pid } from "../http/serialize.js";
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

const IsoDate = z.iso.date().openapi({ example: "2024-03-01" });

const AffiliationSchema = z
  .object({
    id: publicId("affiliation"),
    organizationId: publicId("organization"),
    organizationName: z.string(),
    title: z.string().nullable(),
    from: IsoDate.nullable(),
    to: IsoDate.nullable().openapi({ description: "Empty while the affiliation is current" }),
    version: z.int(),
  })
  .openapi("Affiliation");

const HandleSchema = z
  .object({
    id: publicId("handle"),
    channelId: publicId("channel"),
    channelName: z.string(),
    value: z.string().openapi({ description: "Email address, profile URL, phone number, …" }),
    version: z.int(),
  })
  .openapi("Handle");

export const ContactSchema = z
  .object({
    id: publicId("contact"),
    name: z.string(),
    notes: z.string().nullable(),
    affiliations: z.array(AffiliationSchema),
    handles: z.array(HandleSchema),
    version: z.int(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    deletedAt: Timestamp.nullable(),
  })
  .openapi("Contact");

const AffiliationInput = z.object({
  organizationId: publicId("organization"),
  title: z.string().max(300).nullable().optional(),
  from: IsoDate.nullable().optional(),
  to: IsoDate.nullable().optional(),
});

const HandleInput = z.object({ channelId: publicId("channel"), value: z.string().trim().min(1).max(2000) });

const ContactInput = z.object({
  name: z.string().trim().min(1).max(300),
  notes: z.string().max(100_000).nullable().optional(),
});

const ContactParams = withProject({ contactId: pathId("contact", "contactId") });
const AffiliationParams = withProject({
  contactId: pathId("contact", "contactId"),
  affiliationId: pathId("affiliation", "affiliationId"),
});
const HandleParams = withProject({
  contactId: pathId("contact", "contactId"),
  handleId: pathId("handle", "handleId"),
});
const VersionQuery = z.object({ version: z.coerce.number().int().optional() });

type ContactRow = typeof contact.$inferSelect;
type AffiliationRow = typeof contactAffiliation.$inferSelect;
type HandleRow = typeof contactHandle.$inferSelect;

/** Loads contacts with their (non-deleted) affiliations and handles. */
export async function loadContacts(tx: Tx, rows: ContactRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const affiliations = await tx
    .select({ a: contactAffiliation, orgName: organization.name })
    .from(contactAffiliation)
    .innerJoin(organization, eq(organization.id, contactAffiliation.organizationId))
    .where(and(inArray(contactAffiliation.contactId, ids), isNull(contactAffiliation.deletedAt)))
    .orderBy(asc(contactAffiliation.id));
  const handles = await tx
    .select({ h: contactHandle, channelName: channel.name })
    .from(contactHandle)
    .innerJoin(channel, eq(channel.id, contactHandle.channelId))
    .where(and(inArray(contactHandle.contactId, ids), isNull(contactHandle.deletedAt)))
    .orderBy(asc(contactHandle.id));
  return rows.map((r) => ({
    id: pid("contact", r.id),
    name: r.name,
    notes: r.notes,
    affiliations: affiliations
      .filter((x) => x.a.contactId === r.id)
      .map(({ a, orgName }) => affiliationView(a, orgName)),
    handles: handles.filter((x) => x.h.contactId === r.id).map(({ h, channelName }) => handleView(h, channelName)),
    version: r.version,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    deletedAt: r.deletedAt ? iso(r.deletedAt) : null,
  }));
}

const affiliationView = (a: AffiliationRow, organizationName: string) => ({
  id: pid("affiliation", a.id),
  organizationId: pid("organization", a.organizationId),
  organizationName,
  title: a.title,
  from: dateOrNull(a.fromDate),
  to: dateOrNull(a.toDate),
  version: a.version,
});

const handleView = (h: HandleRow, channelName: string) => ({
  id: pid("handle", h.id),
  channelId: pid("channel", h.channelId),
  channelName,
  value: h.value,
  version: h.version,
});

async function loadContact(tx: Tx, s: Scope, id: string) {
  const [row] = await tx
    .select()
    .from(contact)
    .where(visible(contact, s, id));
  if (!row) throw notFound("Contact");
  return (await loadContacts(tx, [row]))[0]!;
}

async function insertAffiliation(tx: Tx, s: Scope, contactId: string, input: z.infer<typeof AffiliationInput>) {
  const organizationId = uuidOf("organization", input.organizationId);
  await requireVisible(tx, organization, s, organizationId, "Organization");
  const [row] = await tx
    .insert(contactAffiliation)
    .values({
      id: newUuid(),
      projectId: s.projectId,
      contactId,
      organizationId,
      title: input.title ?? null,
      fromDate: input.from ?? null,
      toDate: input.to ?? null,
      createdBy: s.actor.userId,
    })
    .returning();
  await audit(tx, s, { entityType: "affiliation", entityId: row!.id, op: "create", diff: { contactId, ...input } });
}

async function insertHandle(tx: Tx, s: Scope, contactId: string, input: z.infer<typeof HandleInput>) {
  const channelId = uuidOf("channel", input.channelId);
  await requireVisible(tx, channel, s, channelId, "Channel");
  const [row] = await tx
    .insert(contactHandle)
    .values({
      id: newUuid(),
      projectId: s.projectId,
      contactId,
      channelId,
      value: input.value,
      createdBy: s.actor.userId,
    })
    .returning();
  await audit(tx, s, { entityType: "handle", entityId: row!.id, op: "create", diff: { contactId, ...input } });
}

const listContacts = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/contacts",
  operationId: "listContacts",
  summary: "List or search contacts",
  description:
    "People at companies and agencies. `q` matches names, notes and handle values (e.g. an email address); " +
    "`organizationId` returns people currently affiliated with that organization.",
  scope: "project",
  permissions: ["contact:read"],
  mcp: { expose: true },
  tags: ["Contacts"],
  request: {
    params: ProjectParams,
    query: ListQuery.extend({
      q: z.string().max(200).optional(),
      organizationId: publicId("organization").optional(),
      deleted: z.enum(["true", "false"]).optional(),
    }),
  },
  responses: { 200: jsonResponse(page(ContactSchema), "Contacts"), ...errorResponses(404) },
});

const getContact = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/contacts/{contactId}",
  operationId: "getContact",
  summary: "Get a contact",
  description: "Returns a contact with affiliations and handles.",
  scope: "project",
  permissions: ["contact:read"],
  mcp: { expose: true },
  tags: ["Contacts"],
  request: { params: ContactParams },
  responses: { 200: jsonResponse(ContactSchema, "Contact"), ...errorResponses(404) },
});

const createContact = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/contacts",
  operationId: "createContact",
  summary: "Create a contact",
  description:
    "Adds a person, optionally with where they work (`affiliations`) and how to reach them (`handles`). " +
    "Search first to avoid duplicates.",
  scope: "project",
  permissions: ["contact:create"],
  mcp: { expose: true },
  tags: ["Contacts"],
  request: {
    params: ProjectParams,
    body: jsonBody(
      ContactInput.extend({
        affiliations: z.array(AffiliationInput).max(50).default([]),
        handles: z.array(HandleInput).max(50).default([]),
      }),
    ),
  },
  responses: { 201: jsonResponse(ContactSchema, "Created"), ...errorResponses(403, 404) },
});

const updateContact = defineRoute({
  method: "patch",
  path: "/api/projects/{projectId}/contacts/{contactId}",
  operationId: "updateContact",
  summary: "Update a contact",
  description: "Changes a contact's name or notes. Affiliations and handles have their own operations.",
  scope: "project",
  permissions: ["contact:update"],
  mcp: { expose: true },
  tags: ["Contacts"],
  request: {
    params: ContactParams,
    body: jsonBody(ContactInput.partial().extend({ version: VersionField.optional() })),
  },
  responses: { 200: jsonResponse(ContactSchema, "Updated"), ...errorResponses(403, 404, 412, 428) },
});

const deleteContact = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/contacts/{contactId}",
  operationId: "deleteContact",
  summary: "Delete a contact",
  description: "Soft-deletes a contact; it can be restored. Use purgeContact to erase personal data.",
  scope: "project",
  permissions: ["contact:delete"],
  tags: ["Contacts"],
  request: { params: ContactParams, query: VersionQuery },
  responses: { 204: NoContent, ...errorResponses(403, 404, 412, 428) },
});

const restoreContact = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/contacts/{contactId}/restore",
  operationId: "restoreContact",
  summary: "Restore a deleted contact",
  description: "Undoes a delete.",
  scope: "project",
  permissions: ["contact:delete"],
  tags: ["Contacts"],
  request: { params: ContactParams },
  responses: { 204: NoContent, ...errorResponses(403, 404) },
});

const purgeContact = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/contacts/{contactId}/purge",
  operationId: "purgeContact",
  summary: "Erase a contact permanently",
  description:
    "Hard-deletes the contact with their handles, affiliations and action participation, and redacts their data " +
    "from the audit log. Cannot be undone. Owner only.",
  scope: "project",
  permissions: ["contact:purge"],
  tags: ["Contacts"],
  request: { params: ContactParams },
  responses: { 204: NoContent, ...errorResponses(403, 404) },
});

const addAffiliation = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/contacts/{contactId}/affiliations",
  operationId: "addAffiliation",
  summary: "Add where a contact works",
  description: "Records that the contact works (or worked, with `to` set) at an organization.",
  scope: "project",
  permissions: ["contact:update"],
  mcp: { expose: true },
  tags: ["Contacts"],
  request: { params: ContactParams, body: jsonBody(AffiliationInput) },
  responses: { 201: jsonResponse(ContactSchema, "Updated contact"), ...errorResponses(403, 404) },
});

const updateAffiliation = defineRoute({
  method: "patch",
  path: "/api/projects/{projectId}/contacts/{contactId}/affiliations/{affiliationId}",
  operationId: "updateAffiliation",
  summary: "Update an affiliation",
  description: "Changes title or dates, e.g. set `to` when the person moved on.",
  scope: "project",
  permissions: ["contact:update"],
  mcp: { expose: true },
  tags: ["Contacts"],
  request: {
    params: AffiliationParams,
    body: jsonBody(
      AffiliationInput.omit({ organizationId: true }).partial().extend({ version: VersionField.optional() }),
    ),
  },
  responses: { 200: jsonResponse(ContactSchema, "Updated contact"), ...errorResponses(403, 404, 412, 428) },
});

const removeAffiliation = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/contacts/{contactId}/affiliations/{affiliationId}",
  operationId: "removeAffiliation",
  summary: "Remove an affiliation",
  description: "Removes an affiliation recorded by mistake. To record that someone left, set `to` instead.",
  scope: "project",
  permissions: ["contact:update"],
  tags: ["Contacts"],
  request: { params: AffiliationParams, query: VersionQuery },
  responses: { 204: NoContent, ...errorResponses(403, 404, 412, 428) },
});

const addHandle = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/contacts/{contactId}/handles",
  operationId: "addHandle",
  summary: "Add a way to reach a contact",
  description: "Adds an email address, profile URL, phone number or similar on a channel.",
  scope: "project",
  permissions: ["contact:update"],
  mcp: { expose: true },
  tags: ["Contacts"],
  request: { params: ContactParams, body: jsonBody(HandleInput) },
  responses: { 201: jsonResponse(ContactSchema, "Updated contact"), ...errorResponses(403, 404) },
});

const removeHandle = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/contacts/{contactId}/handles/{handleId}",
  operationId: "removeHandle",
  summary: "Remove a handle",
  description: "Removes a way to reach a contact.",
  scope: "project",
  permissions: ["contact:update"],
  tags: ["Contacts"],
  request: { params: HandleParams, query: VersionQuery },
  responses: { 204: NoContent, ...errorResponses(403, 404, 412, 428) },
});

export function registerContactRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listContacts, async (c) => {
    const s = scopeOf(c);
    const q = c.req.valid("query");
    const conditions: (SQL | undefined)[] = [
      eq(contact.projectId, s.projectId),
      q.deleted === "true" ? isNotNull(contact.deletedAt) : isNull(contact.deletedAt),
      cursorCondition(contact.id, q.cursor),
    ];
    const tsq = q.q ? prefixQuery(q.q) : null;
    if (q.q) {
      const handleMatch = sql`exists (select 1 from ${contactHandle} h where h.contact_id = ${contact.id} and h.deleted_at is null and h.value ilike ${`%${q.q}%`})`;
      conditions.push(tsq ? or(sql`${contact.search} @@ to_tsquery('simple', ${tsq})`, handleMatch) : handleMatch);
    }
    if (q.organizationId) {
      const orgId = uuidOf("organization", q.organizationId);
      conditions.push(
        sql`exists (select 1 from ${contactAffiliation} a where a.contact_id = ${contact.id} and a.deleted_at is null and a.organization_id = ${orgId} and (a.to_date is null or a.to_date >= current_date))`,
      );
    }
    const rows = await s.db
      .select()
      .from(contact)
      .where(and(...conditions))
      .orderBy(desc(contact.id))
      .limit(q.limit + 1);
    const result = nextCursor(rows, q.limit);
    return c.json({ items: await loadContacts(s.db, result.items), nextCursor: result.nextCursor }, 200);
  });

  app.openapi(getContact, async (c) => {
    const s = scopeOf(c);
    const view = await loadContact(s.db, s, uuidOf("contact", c.req.valid("param").contactId));
    c.header("ETag", etag(view.version));
    return c.json(view, 200);
  });

  app.openapi(createContact, async (c) => {
    const s = scopeOf(c);
    const { affiliations, handles, ...body } = c.req.valid("json");
    const view = await s.db.transaction(async (tx) => {
      const id = newUuid();
      await tx.insert(contact).values({
        id,
        projectId: s.projectId,
        name: body.name,
        notes: body.notes ?? null,
        createdBy: s.actor.userId,
      });
      await audit(tx, s, { entityType: "contact", entityId: id, op: "create", diff: { after: body } });
      for (const a of affiliations) await insertAffiliation(tx, s, id, a);
      for (const h of handles) await insertHandle(tx, s, id, h);
      return loadContact(tx, s, id);
    });
    return c.json(view, 201);
  });

  app.openapi(updateContact, async (c) => {
    const s = scopeOf(c);
    const { version, ...set } = c.req.valid("json");
    const id = uuidOf("contact", c.req.valid("param").contactId);
    const view = await s.db.transaction(async (tx) => {
      const { before } = await updateVersioned<typeof contact, ContactRow>(tx, contact, s, {
        id,
        expectedVersion: expectedVersion(c, version),
        set,
        entityName: "Contact",
      });
      await audit(tx, s, { entityType: "contact", entityId: id, op: "update", diff: diffOf(before, set) });
      return loadContact(tx, s, id);
    });
    c.header("ETag", etag(view.version));
    return c.json(view, 200);
  });

  app.openapi(deleteContact, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("contact", c.req.valid("param").contactId);
    const version = expectedVersion(c, c.req.valid("query").version);
    await s.db.transaction((tx) =>
      softDelete(tx, contact, s, { id, expectedVersion: version, entityName: "Contact", entityType: "contact" }),
    );
    return c.body(null, 204);
  });

  app.openapi(restoreContact, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("contact", c.req.valid("param").contactId);
    await s.db.transaction((tx) => restore(tx, contact, s, { id, entityName: "Contact", entityType: "contact" }));
    return c.body(null, 204);
  });

  app.openapi(purgeContact, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("contact", c.req.valid("param").contactId);
    await s.db.transaction((tx) => purge(tx, s, id));
    return c.body(null, 204);
  });

  app.openapi(addAffiliation, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("contact", c.req.valid("param").contactId);
    const view = await s.db.transaction(async (tx) => {
      await requireVisible(tx, contact, s, id, "Contact");
      await insertAffiliation(tx, s, id, c.req.valid("json"));
      return loadContact(tx, s, id);
    });
    return c.json(view, 201);
  });

  app.openapi(updateAffiliation, async (c) => {
    const s = scopeOf(c);
    const params = c.req.valid("param");
    const contactId = uuidOf("contact", params.contactId);
    const affiliationId = uuidOf("affiliation", params.affiliationId);
    const { version, from, to, ...rest } = c.req.valid("json");
    const set = {
      ...rest,
      ...(from === undefined ? {} : { fromDate: from }),
      ...(to === undefined ? {} : { toDate: to }),
    };
    const view = await s.db.transaction(async (tx) => {
      await requireAffiliationOf(tx, s, contactId, affiliationId);
      const { before } = await updateVersioned<typeof contactAffiliation, AffiliationRow>(tx, contactAffiliation, s, {
        id: affiliationId,
        expectedVersion: expectedVersion(c, version),
        set,
        entityName: "Affiliation",
      });
      await audit(tx, s, {
        entityType: "affiliation",
        entityId: affiliationId,
        op: "update",
        diff: diffOf(before, set),
      });
      return loadContact(tx, s, contactId);
    });
    return c.json(view, 200);
  });

  app.openapi(removeAffiliation, async (c) => {
    const s = scopeOf(c);
    const params = c.req.valid("param");
    const contactId = uuidOf("contact", params.contactId);
    const affiliationId = uuidOf("affiliation", params.affiliationId);
    const version = expectedVersion(c, c.req.valid("query").version);
    await s.db.transaction(async (tx) => {
      await requireAffiliationOf(tx, s, contactId, affiliationId);
      await softDelete(tx, contactAffiliation, s, {
        id: affiliationId,
        expectedVersion: version,
        entityName: "Affiliation",
        entityType: "affiliation",
      });
    });
    return c.body(null, 204);
  });

  app.openapi(addHandle, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("contact", c.req.valid("param").contactId);
    const view = await s.db.transaction(async (tx) => {
      await requireVisible(tx, contact, s, id, "Contact");
      await insertHandle(tx, s, id, c.req.valid("json"));
      return loadContact(tx, s, id);
    });
    return c.json(view, 201);
  });

  app.openapi(removeHandle, async (c) => {
    const s = scopeOf(c);
    const params = c.req.valid("param");
    const contactId = uuidOf("contact", params.contactId);
    const handleId = uuidOf("handle", params.handleId);
    const version = expectedVersion(c, c.req.valid("query").version);
    await s.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: contactHandle.id })
        .from(contactHandle)
        .where(and(visible(contactHandle, s, handleId), eq(contactHandle.contactId, contactId)));
      if (!row) throw notFound("Handle");
      await softDelete(tx, contactHandle, s, {
        id: handleId,
        expectedVersion: version,
        entityName: "Handle",
        entityType: "handle",
      });
    });
    return c.body(null, 204);
  });
}

async function requireAffiliationOf(tx: Tx, s: Scope, contactId: string, affiliationId: string) {
  const [row] = await tx
    .select({ id: contactAffiliation.id })
    .from(contactAffiliation)
    .where(and(visible(contactAffiliation, s, affiliationId), eq(contactAffiliation.contactId, contactId)));
  if (!row) throw notFound("Affiliation");
}

/** Hard-deletes a contact and redacts audit diffs that could contain their data (ADR 0017). */
export async function purge(tx: Tx, s: Scope, contactId: string) {
  const [row] = await tx
    .select({ id: contact.id })
    .from(contact)
    .where(and(eq(contact.projectId, s.projectId), eq(contact.id, contactId)));
  if (!row) throw notFound("Contact");
  const handles = await tx
    .select({ id: contactHandle.id })
    .from(contactHandle)
    .where(eq(contactHandle.contactId, contactId));
  const affiliations = await tx
    .select({ id: contactAffiliation.id })
    .from(contactAffiliation)
    .where(eq(contactAffiliation.contactId, contactId));
  const entityIds = [contactId, ...handles.map((h) => h.id), ...affiliations.map((a) => a.id)];
  await tx
    .update(auditEvent)
    .set({ diff: sql`'{"redacted": true}'::jsonb` })
    .where(and(eq(auditEvent.projectId, s.projectId), inArray(auditEvent.entityId, entityIds)));
  // Handles, affiliations and action participation cascade.
  await tx.delete(contact).where(eq(contact.id, contactId));
  await audit(tx, s, { entityType: "contact", entityId: contactId, op: "purge" });
}
