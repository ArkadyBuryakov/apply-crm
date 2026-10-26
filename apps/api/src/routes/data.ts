// Export and import (ADR 0017).

import { organization, position, positionStage, project } from "@crm/db";
import { newUuid, POSITION_OUTCOMES } from "@crm/shared";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq, sql } from "drizzle-orm";
import { badRequest, errorResponses } from "../http/errors.js";
import { defineRoute, jsonResponse, ProjectParams } from "../http/route.js";
import { scopeOf } from "../http/scope.js";
import type { AppEnv } from "../http/types.js";
import { audit, visible } from "../services/core.js";
import { exportProject, importProject } from "../services/portability.js";

const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

const ImportSummarySchema = z
  .object({
    channels: z.int(),
    stages: z.int(),
    organizations: z.int(),
    contacts: z.int(),
    positions: z.int(),
    actions: z.int(),
    edges: z.int(),
    documents: z.int(),
    templates: z.int(),
    comments: z.int(),
  })
  .openapi("ImportSummary", { description: "Number of entities created" });

const fileField = z.any().openapi({ type: "string", format: "binary" });

const exportRoute = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/export",
  operationId: "exportProject",
  summary: "Export the project",
  description: "Downloads the whole project (including deleted items and document files) as a zip with project.json.",
  scope: "project",
  permissions: ["data:export"],
  tags: ["Data"],
  request: { params: ProjectParams },
  responses: {
    200: { description: "Zip archive", content: { "application/zip": { schema: fileField } } },
    ...errorResponses(403, 404),
  },
});

const importRoute = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/import",
  operationId: "importProject",
  summary: "Import an export archive",
  description:
    "Adds everything from an export zip to this project with new IDs. Channels and stages are matched by name and " +
    "key; assignees and comment authors are matched by email among the project's members, otherwise you.",
  scope: "project",
  permissions: ["data:import"],
  tags: ["Data"],
  request: {
    params: ProjectParams,
    body: { required: true, content: { "multipart/form-data": { schema: z.object({ file: fileField }) } } },
  },
  responses: { 201: jsonResponse(ImportSummarySchema, "Imported"), ...errorResponses(400, 403, 404) },
});

const importCsvRoute = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/import/positions.csv",
  operationId: "importPositionsCsv",
  summary: "Import positions from CSV",
  description:
    "Columns (header row, any order): title (required), company, agency, url, stage (stage key), outcome, " +
    "salary_min, salary_max, currency, notes. Organizations are matched by name or created.",
  scope: "project",
  permissions: ["position:create", "organization_entity:create"],
  tags: ["Data"],
  request: {
    params: ProjectParams,
    body: { required: true, content: { "multipart/form-data": { schema: z.object({ file: fileField }) } } },
  },
  responses: {
    201: jsonResponse(z.object({ positions: z.int(), organizations: z.int() }), "Imported"),
    ...errorResponses(400, 403, 404),
  },
});

async function fileBytes(value: unknown, maxBytes: number) {
  if (!(value instanceof File)) throw badRequest("Attach the file in the `file` field");
  if (value.size > maxBytes) throw badRequest("File too large");
  return new Uint8Array(await value.arrayBuffer());
}

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF or LF line endings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export function registerDataRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(exportRoute, async (c) => {
    const s = scopeOf(c);
    const zip = await exportProject(s.db, c.var.deps.services.blobs, s.projectId);
    const [proj] = await s.db.select({ name: project.name }).from(project).where(eq(project.id, s.projectId));
    const slug =
      (proj?.name ?? "project")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "project";
    return new Response(zip, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${slug}-${new Date().toISOString().slice(0, 10)}.zip"`,
      },
    }) as never;
  });

  app.openapi(importRoute, async (c) => {
    const s = scopeOf(c);
    const bytes = await fileBytes(c.req.valid("form").file, MAX_IMPORT_BYTES);
    const summary = await s.db.transaction((tx) => importProject(tx, s, c.var.deps.services.blobs, bytes));
    return c.json(summary, 201);
  });

  app.openapi(importCsvRoute, async (c) => {
    const s = scopeOf(c);
    const bytes = await fileBytes(c.req.valid("form").file, 10 * 1024 * 1024);
    const rows = parseCsv(new TextDecoder().decode(bytes).replace(/^﻿/, ""));
    const [header, ...data] = rows;
    if (!header) throw badRequest("The CSV is empty");
    const col = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]));
    if (col.title === undefined) throw badRequest("The CSV needs a `title` column");
    const get = (r: string[], name: string) => {
      const i = col[name];
      const v = i === undefined ? "" : (r[i] ?? "").trim();
      return v === "" ? null : v;
    };
    const result = await s.db.transaction(async (tx) => {
      const stages = await tx.select().from(positionStage).where(visible(positionStage, s));
      const firstStage = [...stages].sort((a, b) => a.order - b.order)[0];
      if (!firstStage) throw badRequest("The project has no pipeline stages");
      const orgCache = new Map<string, string>();
      let createdOrgs = 0;
      const orgId = async (name: string | null, kind: "company" | "agency") => {
        if (!name) return null;
        const key = `${kind}:${name.toLowerCase()}`;
        if (orgCache.has(key)) return orgCache.get(key)!;
        const [existing] = await tx
          .select({ id: organization.id })
          .from(organization)
          .where(
            and(
              visible(organization, s),
              eq(organization.kind, kind),
              sql`lower(${organization.name}) = ${name.toLowerCase()}`,
            ),
          );
        let id = existing?.id;
        if (!id) {
          id = newUuid();
          await tx.insert(organization).values({ id, projectId: s.projectId, kind, name, createdBy: s.actor.userId });
          createdOrgs++;
        }
        orgCache.set(key, id);
        return id;
      };
      let line = 1;
      for (const r of data) {
        line++;
        const title = get(r, "title");
        if (!title) throw badRequest(`Line ${line}: title is required`);
        const stageKey = get(r, "stage");
        const stage = stageKey ? stages.find((st) => st.key === stageKey) : firstStage;
        if (!stage) throw badRequest(`Line ${line}: unknown stage "${stageKey}"`);
        const outcome = get(r, "outcome") ?? "open";
        if (!(POSITION_OUTCOMES as readonly string[]).includes(outcome))
          throw badRequest(`Line ${line}: unknown outcome "${outcome}"`);
        const num = (name: string) => {
          const v = get(r, name);
          if (v === null) return null;
          const n = Number(v.replace(/[\s_]/g, ""));
          if (!Number.isFinite(n)) throw badRequest(`Line ${line}: ${name} is not a number`);
          return n;
        };
        await tx.insert(position).values({
          id: newUuid(),
          projectId: s.projectId,
          title,
          companyId: await orgId(get(r, "company"), "company"),
          agencyId: await orgId(get(r, "agency"), "agency"),
          url: get(r, "url"),
          stageId: stage.id,
          outcome,
          salaryMin: num("salary_min"),
          salaryMax: num("salary_max"),
          salaryCurrency: get(r, "currency")?.toUpperCase() ?? null,
          notes: get(r, "notes"),
          createdBy: s.actor.userId,
        });
      }
      await audit(tx, s, {
        entityType: "project",
        entityId: s.projectId,
        op: "create",
        diff: { csvImport: { positions: data.length, organizations: createdOrgs } },
      });
      return { positions: data.length, organizations: createdOrgs };
    });
    return c.json(result, 201);
  });
}
