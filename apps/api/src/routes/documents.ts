// Documents, LaTeX templates and compiled PDFs (ADR 0006, 0025).
import { createHash } from "node:crypto";
import {
  document,
  documentTemplate,
  documentTemplateVersion,
  documentVersion,
  position,
  type TemplateFile,
  type Tx,
} from "@crm/db";
import { COMPILE_STATUSES, DOCUMENT_KINDS, newUuid } from "@crm/shared";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { badRequest, errorResponses, notFound } from "../http/errors.js";
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
import { iso, isoOrNull, pid, pidOrNull } from "../http/serialize.js";
import type { AppEnv } from "../http/types.js";
import { type BlobStore, blobKeys } from "../services/blobs.js";
import { audit, requireVisible, restore, type Scope, softDelete, updateVersioned, visible } from "../services/core.js";
import { diffOf } from "./organizations.js";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_CHARS = 500_000;

const DocumentKindSchema = z.enum(DOCUMENT_KINDS).openapi("DocumentKind");
const CompileStatusSchema = z.enum(COMPILE_STATUSES).openapi("CompileStatus");

const VersionSummarySchema = z
  .object({
    id: publicId("documentVersion"),
    versionNo: z.int(),
    format: z.enum(["latex", "file"]),
    filename: z.string(),
    mime: z.string(),
    size: z.int(),
    sha256: z.string(),
    templateVersionId: publicId("templateVersion").nullable(),
    compileStatus: CompileStatusSchema.nullable(),
    hasPdf: z.boolean(),
    compiledAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .openapi("DocumentVersionSummary");

const VersionDetailSchema = VersionSummarySchema.extend({
  documentId: publicId("document"),
  source: z.string().nullable().openapi({ description: "LaTeX source, for LaTeX versions" }),
  compileLog: z.string().nullable(),
}).openapi("DocumentVersion");

const DocumentSchema = z
  .object({
    id: publicId("document"),
    kind: DocumentKindSchema,
    title: z.string(),
    positionId: publicId("position")
      .nullable()
      .openapi({ description: "Set for documents tailored to a position; empty for e.g. the main resume" }),
    derivedFromVersionId: publicId("documentVersion").nullable(),
    notes: z.string().nullable(),
    versions: z.array(VersionSummarySchema).openapi({ description: "Newest first" }),
    version: z.int(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    deletedAt: Timestamp.nullable(),
  })
  .openapi("Document");

const TemplateSchema = z
  .object({
    id: publicId("template"),
    name: z.string(),
    notes: z.string().nullable(),
    versions: z.array(
      z.object({
        id: publicId("templateVersion"),
        versionNo: z.int(),
        files: z.array(z.object({ name: z.string(), size: z.int(), sha256: z.string() })),
        createdAt: Timestamp,
      }),
    ),
    version: z.int(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Template");

type VersionRow = typeof documentVersion.$inferSelect;
type DocumentRow = typeof document.$inferSelect;

function versionSummary(v: VersionRow) {
  return {
    id: pid("documentVersion", v.id),
    versionNo: v.versionNo,
    format: (v.source === null ? "file" : "latex") as "latex" | "file",
    filename: v.filename,
    mime: v.mime,
    size: v.size,
    sha256: v.sha256,
    templateVersionId: pidOrNull("templateVersion", v.templateVersionId),
    compileStatus: v.compileStatus as (typeof COMPILE_STATUSES)[number] | null,
    hasPdf: v.pdfBlobKey !== null || v.mime === "application/pdf",
    compiledAt: isoOrNull(v.compiledAt),
    createdAt: iso(v.createdAt),
  };
}

function versionDetail(v: VersionRow) {
  return {
    ...versionSummary(v),
    documentId: pid("document", v.documentId),
    source: v.source,
    compileLog: v.compileLog,
  };
}

async function loadDocument(tx: Tx, s: Scope, id: string, includeDeleted = false) {
  const [row] = await tx
    .select()
    .from(document)
    .where(includeDeleted ? and(eq(document.projectId, s.projectId), eq(document.id, id)) : visible(document, s, id));
  if (!row) throw notFound("Document");
  return documentView(tx, row);
}

async function documentView(tx: Tx, row: DocumentRow) {
  const versions = await tx
    .select()
    .from(documentVersion)
    .where(eq(documentVersion.documentId, row.id))
    .orderBy(desc(documentVersion.versionNo));
  return {
    id: pid("document", row.id),
    kind: row.kind as (typeof DOCUMENT_KINDS)[number],
    title: row.title,
    positionId: pidOrNull("position", row.positionId),
    derivedFromVersionId: pidOrNull("documentVersion", row.derivedFromVersionId),
    notes: row.notes,
    versions: versions.map(versionSummary),
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    deletedAt: isoOrNull(row.deletedAt),
  };
}

async function loadVersion(tx: Tx, s: Scope, documentId: string, versionId: string) {
  const [row] = await tx
    .select()
    .from(documentVersion)
    .innerJoin(document, eq(document.id, documentVersion.documentId))
    .where(
      and(
        eq(documentVersion.projectId, s.projectId),
        eq(documentVersion.id, versionId),
        eq(documentVersion.documentId, documentId),
        isNull(document.deletedAt),
      ),
    );
  if (!row) throw notFound("Document version");
  return row.document_version;
}

async function nextVersionNo(tx: Tx, documentId: string) {
  const [row] = await tx
    .select({ next: sql<number>`coalesce(max(${documentVersion.versionNo}), 0)::int + 1` })
    .from(documentVersion)
    .where(eq(documentVersion.documentId, documentId));
  return row?.next ?? 1;
}

export const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** Safe file name for storage and for LaTeX inputs: no directories, no shell-significant characters. */
export function safeFilename(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  if (!cleaned) throw badRequest("Invalid file name");
  return cleaned.slice(0, 120);
}

/** Creates a LaTeX version and queues its compilation (ADR 0024, 0025). */
export async function createLatexVersion(
  tx: Tx,
  s: Scope,
  documentId: string,
  input: { source: string; templateVersionId: string | null; filename: string },
) {
  if (input.templateVersionId) {
    const [tv] = await tx
      .select({ id: documentTemplateVersion.id })
      .from(documentTemplateVersion)
      .where(
        and(
          eq(documentTemplateVersion.projectId, s.projectId),
          eq(documentTemplateVersion.id, input.templateVersionId),
        ),
      );
    if (!tv) throw notFound("Template version");
  }
  const id = newUuid();
  const filename = safeFilename(input.filename.endsWith(".tex") ? input.filename : `${input.filename}.tex`);
  const [row] = await tx
    .insert(documentVersion)
    .values({
      id,
      projectId: s.projectId,
      documentId,
      versionNo: await nextVersionNo(tx, documentId),
      filename,
      mime: "application/x-tex",
      size: Buffer.byteLength(input.source),
      sha256: sha256(input.source),
      source: input.source,
      templateVersionId: input.templateVersionId,
      compileStatus: "queued",
      createdBy: s.actor.userId,
    })
    .returning();
  await tx.update(document).set({ updatedAt: new Date() }).where(eq(document.id, documentId));
  await audit(tx, s, {
    entityType: "documentVersion",
    entityId: id,
    op: "create",
    diff: { documentId, filename, templateVersionId: input.templateVersionId, size: row!.size },
  });
  return row!;
}

const DocumentParams = withProject({ documentId: pathId("document", "documentId") });
const VersionParams = withProject({
  documentId: pathId("document", "documentId"),
  versionId: pathId("documentVersion", "versionId"),
});
const TemplateParams = withProject({ templateId: pathId("template", "templateId") });

const fileField = z.any().openapi({ type: "string", format: "binary" });
const binaryResponse = (description: string) =>
  ({
    description,
    content: { "application/octet-stream": { schema: z.any().openapi({ type: "string", format: "binary" }) } },
  }) as const;

const listDocuments = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/documents",
  operationId: "listDocuments",
  summary: "List documents",
  description:
    "Resumes, cover letters, take-home submissions, offers. `positionId` lists documents tailored for a position; " +
    "`main=true` lists documents not tied to any position (e.g. the main resume).",
  scope: "project",
  permissions: ["document:read"],
  mcp: { expose: true },
  tags: ["Documents"],
  request: {
    params: ProjectParams,
    query: z.object({
      kind: DocumentKindSchema.optional(),
      positionId: publicId("position").optional(),
      main: z.enum(["true", "false"]).optional(),
      deleted: z.enum(["true", "false"]).optional(),
    }),
  },
  responses: { 200: jsonResponse(z.object({ items: z.array(DocumentSchema) }), "Documents"), ...errorResponses(404) },
});

const getDocument = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/documents/{documentId}",
  operationId: "getDocument",
  summary: "Get a document",
  description: "Returns a document with its version list (without sources).",
  scope: "project",
  permissions: ["document:read"],
  tags: ["Documents"],
  request: { params: DocumentParams },
  responses: { 200: jsonResponse(DocumentSchema, "Document"), ...errorResponses(404) },
});

const createDocument = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/documents",
  operationId: "createDocument",
  summary: "Create a document",
  description:
    "Creates an empty document; add content with createLatexVersion or an upload. For a resume tailored to a " +
    "position, set `positionId` and `derivedFromVersionId` (the main resume version it is based on).",
  scope: "project",
  permissions: ["document:create"],
  mcp: { expose: true },
  tags: ["Documents"],
  request: {
    params: ProjectParams,
    body: jsonBody(
      z.object({
        kind: DocumentKindSchema,
        title: z.string().trim().min(1).max(300),
        positionId: publicId("position").nullable().optional(),
        derivedFromVersionId: publicId("documentVersion").nullable().optional(),
        notes: z.string().max(100_000).nullable().optional(),
      }),
    ),
  },
  responses: { 201: jsonResponse(DocumentSchema, "Created"), ...errorResponses(403, 404) },
});

const updateDocument = defineRoute({
  method: "patch",
  path: "/api/projects/{projectId}/documents/{documentId}",
  operationId: "updateDocument",
  summary: "Update a document",
  description: "Renames a document or changes its notes. Content changes create new versions instead.",
  scope: "project",
  permissions: ["document:update"],
  tags: ["Documents"],
  request: {
    params: DocumentParams,
    body: jsonBody(
      z.object({
        title: z.string().trim().min(1).max(300).optional(),
        notes: z.string().max(100_000).nullable().optional(),
        version: VersionField.optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse(DocumentSchema, "Updated"), ...errorResponses(403, 404, 412, 428) },
});

const deleteDocument = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/documents/{documentId}",
  operationId: "deleteDocument",
  summary: "Delete a document",
  description: "Soft-deletes a document; versions referenced by actions are kept.",
  scope: "project",
  permissions: ["document:delete"],
  tags: ["Documents"],
  request: { params: DocumentParams, query: z.object({ version: z.coerce.number().int().optional() }) },
  responses: { 204: NoContent, ...errorResponses(403, 404, 412, 428) },
});

const restoreDocument = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/documents/{documentId}/restore",
  operationId: "restoreDocument",
  summary: "Restore a deleted document",
  description: "Undoes a delete.",
  scope: "project",
  permissions: ["document:delete"],
  tags: ["Documents"],
  request: { params: DocumentParams },
  responses: { 204: NoContent, ...errorResponses(403, 404) },
});

const createLatexVersionRoute = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/documents/{documentId}/versions/latex",
  operationId: "createLatexVersion",
  summary: "Add a LaTeX version to a document",
  description:
    "Stores LaTeX source as a new immutable version and queues PDF compilation with the given template version " +
    "(its .cls and other files sit next to the source). Typical flow for tailoring: read the main resume version " +
    "with getDocumentVersion, edit the source, create a tailored document and add the edited source here. " +
    "Poll getDocumentVersion for `compileStatus`.",
  scope: "project",
  permissions: ["document:update"],
  mcp: { expose: true },
  tags: ["Documents"],
  request: {
    params: DocumentParams,
    body: jsonBody(
      z.object({
        source: z.string().min(1).max(MAX_SOURCE_CHARS),
        templateVersionId: publicId("templateVersion").nullable().optional(),
        filename: z.string().max(120).default("main.tex"),
      }),
    ),
  },
  responses: { 201: jsonResponse(VersionDetailSchema, "Created"), ...errorResponses(400, 403, 404) },
});

const uploadVersion = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/documents/{documentId}/versions/upload",
  operationId: "uploadDocumentVersion",
  summary: "Upload a file as a new document version",
  description: `Stores any file (PDF, DOCX, ZIP, …) up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB as a new version.`,
  scope: "project",
  permissions: ["document:update"],
  tags: ["Documents"],
  request: {
    params: DocumentParams,
    body: { required: true, content: { "multipart/form-data": { schema: z.object({ file: fileField }) } } },
  },
  responses: { 201: jsonResponse(VersionDetailSchema, "Created"), ...errorResponses(400, 403, 404) },
});

const getVersion = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/documents/{documentId}/versions/{versionId}",
  operationId: "getDocumentVersion",
  summary: "Get a document version with its source",
  description: "Returns version metadata, the LaTeX source (for LaTeX versions), compile status and log.",
  scope: "project",
  permissions: ["document:read"],
  mcp: { expose: true },
  tags: ["Documents"],
  request: { params: VersionParams },
  responses: { 200: jsonResponse(VersionDetailSchema, "Version"), ...errorResponses(404) },
});

const downloadVersion = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/documents/{documentId}/versions/{versionId}/file",
  operationId: "downloadDocumentVersion",
  summary: "Download a version's file",
  description: "The uploaded file, or the .tex source of a LaTeX version.",
  scope: "project",
  permissions: ["document:read"],
  tags: ["Documents"],
  request: { params: VersionParams },
  responses: { 200: binaryResponse("File"), ...errorResponses(404) },
});

const downloadPdf = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/documents/{documentId}/versions/{versionId}/pdf",
  operationId: "downloadDocumentPdf",
  summary: "Download the PDF of a version",
  description: "The compiled PDF of a LaTeX version, or the file itself when the upload is a PDF.",
  scope: "project",
  permissions: ["document:read"],
  tags: ["Documents"],
  request: { params: VersionParams },
  responses: { 200: binaryResponse("PDF"), ...errorResponses(404, 409) },
});

const recompile = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/documents/{documentId}/versions/{versionId}/compile",
  operationId: "compileDocumentVersion",
  summary: "Compile a LaTeX version again",
  description: "Queues compilation again, e.g. after a failure caused by the template.",
  scope: "project",
  permissions: ["document:update"],
  tags: ["Documents"],
  request: { params: VersionParams },
  responses: { 202: jsonResponse(VersionDetailSchema, "Queued"), ...errorResponses(400, 403, 404) },
});

const listTemplates = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/templates",
  operationId: "listTemplates",
  summary: "List LaTeX templates",
  description: "Templates hold shared LaTeX files (class files, fonts, images) in immutable versions.",
  scope: "project",
  permissions: ["template:read"],
  mcp: { expose: true },
  tags: ["Documents"],
  request: { params: ProjectParams },
  responses: { 200: jsonResponse(z.object({ items: z.array(TemplateSchema) }), "Templates"), ...errorResponses(404) },
});

const createTemplate = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/templates",
  operationId: "createTemplate",
  summary: "Create a LaTeX template",
  description: "Creates an empty template; upload its files as a version.",
  scope: "project",
  permissions: ["template:create"],
  mcp: { expose: true },
  tags: ["Documents"],
  request: {
    params: ProjectParams,
    body: jsonBody(
      z.object({ name: z.string().trim().min(1).max(200), notes: z.string().max(10_000).nullable().optional() }),
    ),
  },
  responses: { 201: jsonResponse(TemplateSchema, "Created"), ...errorResponses(403, 404) },
});

const uploadTemplateVersion = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/templates/{templateId}/versions",
  operationId: "uploadTemplateVersion",
  summary: "Upload a new template version",
  description: "Uploads the complete file set (multipart field `files`, repeatable) as a new immutable version.",
  scope: "project",
  permissions: ["template:update"],
  tags: ["Documents"],
  request: {
    params: TemplateParams,
    body: {
      required: true,
      content: { "multipart/form-data": { schema: z.object({ files: z.union([fileField, z.array(fileField)]) }) } },
    },
  },
  responses: { 201: jsonResponse(TemplateSchema, "Template"), ...errorResponses(400, 403, 404) },
});

const createTemplateVersionRoute = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/templates/{templateId}/versions/inline",
  operationId: "createTemplateVersion",
  summary: "Add a template version from file contents",
  description:
    "JSON alternative to the multipart upload. Pass the complete file set (e.g. the .cls file) as a new immutable " +
    "version; files of earlier versions are not carried over. Text files use `encoding: utf8` (the default), binary " +
    "files such as fonts or images use `base64`. Use the returned version id as `templateVersionId` in " +
    "createLatexVersion.",
  scope: "project",
  permissions: ["template:update"],
  mcp: { expose: true },
  tags: ["Documents"],
  request: {
    params: TemplateParams,
    body: jsonBody(
      z.object({
        files: z
          .array(
            z.object({
              name: z.string().min(1).max(120),
              content: z.string().max(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 4),
              encoding: z.enum(["utf8", "base64"]).default("utf8"),
            }),
          )
          .min(1)
          .max(50),
      }),
    ),
  },
  responses: { 201: jsonResponse(TemplateSchema, "Template"), ...errorResponses(400, 403, 404) },
});

async function templateView(tx: Tx, row: typeof documentTemplate.$inferSelect) {
  const versions = await tx
    .select()
    .from(documentTemplateVersion)
    .where(eq(documentTemplateVersion.templateId, row.id))
    .orderBy(desc(documentTemplateVersion.versionNo));
  return {
    id: pid("template", row.id),
    name: row.name,
    notes: row.notes,
    versions: versions.map((v) => ({
      id: pid("templateVersion", v.id),
      versionNo: v.versionNo,
      files: v.files.map(({ name, size, sha256 }) => ({ name, size, sha256 })),
      createdAt: iso(v.createdAt),
    })),
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function asFiles(value: unknown): File[] {
  const list = Array.isArray(value) ? value : [value];
  const files = list.filter((f): f is File => f instanceof File);
  if (files.length === 0) throw badRequest("Attach at least one file");
  return files;
}

export function registerDocumentRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(listDocuments, async (c) => {
    const s = scopeOf(c);
    const q = c.req.valid("query");
    const conditions: (SQL | undefined)[] = [
      eq(document.projectId, s.projectId),
      q.deleted === "true" ? isNotNull(document.deletedAt) : isNull(document.deletedAt),
    ];
    if (q.kind) conditions.push(eq(document.kind, q.kind));
    if (q.positionId) conditions.push(eq(document.positionId, uuidOf("position", q.positionId)));
    if (q.main === "true") conditions.push(isNull(document.positionId));
    const rows = await s.db
      .select()
      .from(document)
      .where(and(...conditions))
      .orderBy(asc(document.title))
      .limit(500);
    const items = [];
    for (const row of rows) items.push(await documentView(s.db, row));
    return c.json({ items }, 200);
  });

  app.openapi(getDocument, async (c) => {
    const s = scopeOf(c);
    const view = await loadDocument(s.db, s, uuidOf("document", c.req.valid("param").documentId));
    c.header("ETag", etag(view.version));
    return c.json(view, 200);
  });

  app.openapi(createDocument, async (c) => {
    const s = scopeOf(c);
    const body = c.req.valid("json");
    const view = await s.db.transaction(async (tx) => {
      const positionId = body.positionId ? uuidOf("position", body.positionId) : null;
      if (positionId) await requireVisible(tx, position, s, positionId, "Position");
      const derivedFromVersionId = body.derivedFromVersionId
        ? uuidOf("documentVersion", body.derivedFromVersionId)
        : null;
      if (derivedFromVersionId) {
        const [v] = await tx
          .select({ id: documentVersion.id })
          .from(documentVersion)
          .where(and(eq(documentVersion.projectId, s.projectId), eq(documentVersion.id, derivedFromVersionId)));
        if (!v) throw notFound("Document version");
      }
      const id = newUuid();
      await tx.insert(document).values({
        id,
        projectId: s.projectId,
        kind: body.kind,
        title: body.title,
        positionId,
        derivedFromVersionId,
        notes: body.notes ?? null,
        createdBy: s.actor.userId,
      });
      await audit(tx, s, { entityType: "document", entityId: id, op: "create", diff: { after: body } });
      return loadDocument(tx, s, id);
    });
    return c.json(view, 201);
  });

  app.openapi(updateDocument, async (c) => {
    const s = scopeOf(c);
    const { version, ...set } = c.req.valid("json");
    const id = uuidOf("document", c.req.valid("param").documentId);
    const view = await s.db.transaction(async (tx) => {
      const { before } = await updateVersioned<typeof document, DocumentRow>(tx, document, s, {
        id,
        expectedVersion: expectedVersion(c, version),
        set,
        entityName: "Document",
      });
      await audit(tx, s, { entityType: "document", entityId: id, op: "update", diff: diffOf(before, set) });
      return loadDocument(tx, s, id);
    });
    return c.json(view, 200);
  });

  app.openapi(deleteDocument, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("document", c.req.valid("param").documentId);
    const version = expectedVersion(c, c.req.valid("query").version);
    await s.db.transaction((tx) =>
      softDelete(tx, document, s, { id, expectedVersion: version, entityName: "Document", entityType: "document" }),
    );
    return c.body(null, 204);
  });

  app.openapi(restoreDocument, async (c) => {
    const s = scopeOf(c);
    const id = uuidOf("document", c.req.valid("param").documentId);
    await s.db.transaction((tx) => restore(tx, document, s, { id, entityName: "Document", entityType: "document" }));
    return c.body(null, 204);
  });

  app.openapi(createLatexVersionRoute, async (c) => {
    const s = scopeOf(c);
    const { jobs } = c.var.deps.services;
    const documentId = uuidOf("document", c.req.valid("param").documentId);
    const body = c.req.valid("json");
    const row = await s.db.transaction(async (tx) => {
      await requireVisible(tx, document, s, documentId, "Document");
      return createLatexVersion(tx, s, documentId, {
        source: body.source,
        templateVersionId: body.templateVersionId ? uuidOf("templateVersion", body.templateVersionId) : null,
        filename: body.filename,
      });
    });
    await jobs.enqueueCompile({ projectId: s.projectId, documentVersionId: row.id });
    return c.json(versionDetail(row), 201);
  });

  app.openapi(uploadVersion, async (c) => {
    const s = scopeOf(c);
    const { blobs } = c.var.deps.services;
    const documentId = uuidOf("document", c.req.valid("param").documentId);
    const [file] = asFiles(c.req.valid("form").file);
    if (file!.size > MAX_UPLOAD_BYTES) throw badRequest("File too large");
    const bytes = new Uint8Array(await file!.arrayBuffer());
    const filename = safeFilename(file!.name);
    const id = newUuid();
    const key = blobKeys.upload(s.projectId, id, filename);
    await requireVisible(s.db, document, s, documentId, "Document");
    await blobs.put(key, bytes, file!.type || "application/octet-stream");
    const row = await s.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(documentVersion)
        .values({
          id,
          projectId: s.projectId,
          documentId,
          versionNo: await nextVersionNo(tx, documentId),
          blobKey: key,
          filename,
          mime: file!.type || "application/octet-stream",
          size: bytes.byteLength,
          sha256: sha256(bytes),
          createdBy: s.actor.userId,
        })
        .returning();
      await tx.update(document).set({ updatedAt: new Date() }).where(eq(document.id, documentId));
      await audit(tx, s, {
        entityType: "documentVersion",
        entityId: id,
        op: "create",
        diff: { documentId, filename, size: bytes.byteLength },
      });
      return created!;
    });
    return c.json(versionDetail(row), 201);
  });

  app.openapi(getVersion, async (c) => {
    const s = scopeOf(c);
    const params = c.req.valid("param");
    const row = await loadVersion(
      s.db,
      s,
      uuidOf("document", params.documentId),
      uuidOf("documentVersion", params.versionId),
    );
    return c.json(versionDetail(row), 200);
  });

  app.openapi(downloadVersion, async (c) => {
    const s = scopeOf(c);
    const params = c.req.valid("param");
    const row = await loadVersion(
      s.db,
      s,
      uuidOf("document", params.documentId),
      uuidOf("documentVersion", params.versionId),
    );
    const bytes =
      row.source !== null ? new TextEncoder().encode(row.source) : await c.var.deps.services.blobs.get(row.blobKey!);
    if (!bytes) throw notFound("File");
    return new Response(bytes, {
      headers: {
        "content-type": row.mime,
        "content-disposition": `attachment; filename="${row.filename}"`,
      },
    }) as never;
  });

  app.openapi(downloadPdf, async (c) => {
    const s = scopeOf(c);
    const params = c.req.valid("param");
    const row = await loadVersion(
      s.db,
      s,
      uuidOf("document", params.documentId),
      uuidOf("documentVersion", params.versionId),
    );
    const key = row.pdfBlobKey ?? (row.mime === "application/pdf" ? row.blobKey : null);
    if (!key) throw notFound("PDF");
    const bytes = await c.var.deps.services.blobs.get(key);
    if (!bytes) throw notFound("PDF");
    const name = row.filename.replace(/\.[^.]+$/, "") || "document";
    return new Response(bytes, {
      headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"` },
    }) as never;
  });

  app.openapi(recompile, async (c) => {
    const s = scopeOf(c);
    const params = c.req.valid("param");
    const row = await loadVersion(
      s.db,
      s,
      uuidOf("document", params.documentId),
      uuidOf("documentVersion", params.versionId),
    );
    if (row.source === null) throw badRequest("Only LaTeX versions are compiled");
    const [updated] = await s.db
      .update(documentVersion)
      .set({ compileStatus: "queued" })
      .where(eq(documentVersion.id, row.id))
      .returning();
    await c.var.deps.services.jobs.enqueueCompile({ projectId: s.projectId, documentVersionId: row.id });
    return c.json(versionDetail(updated!), 202);
  });

  app.openapi(listTemplates, async (c) => {
    const s = scopeOf(c);
    const rows = await s.db
      .select()
      .from(documentTemplate)
      .where(visible(documentTemplate, s))
      .orderBy(asc(documentTemplate.name));
    const items = [];
    for (const row of rows) items.push(await templateView(s.db, row));
    return c.json({ items }, 200);
  });

  app.openapi(createTemplate, async (c) => {
    const s = scopeOf(c);
    const body = c.req.valid("json");
    const view = await s.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(documentTemplate)
        .values({
          id: newUuid(),
          projectId: s.projectId,
          name: body.name,
          notes: body.notes ?? null,
          createdBy: s.actor.userId,
        })
        .returning();
      await audit(tx, s, { entityType: "template", entityId: row!.id, op: "create", diff: { after: body } });
      return templateView(tx, row!);
    });
    return c.json(view, 201);
  });

  app.openapi(uploadTemplateVersion, async (c) => {
    const s = scopeOf(c);
    const uploads = asFiles(c.req.valid("form").files);
    const files: NewTemplateFile[] = [];
    for (const file of uploads) {
      if (file.size > MAX_UPLOAD_BYTES) throw badRequest(`${file.name} is too large`);
      files.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), type: file.type });
    }
    const view = await addTemplateVersion(c.var.deps.services.blobs, s, c.req.valid("param").templateId, files);
    return c.json(view, 201);
  });

  app.openapi(createTemplateVersionRoute, async (c) => {
    const s = scopeOf(c);
    const files = c.req.valid("json").files.map((f) => {
      const bytes = new Uint8Array(Buffer.from(f.content, f.encoding));
      if (bytes.byteLength > MAX_UPLOAD_BYTES) throw badRequest(`${f.name} is too large`);
      return { name: f.name, bytes };
    });
    const view = await addTemplateVersion(c.var.deps.services.blobs, s, c.req.valid("param").templateId, files);
    return c.json(view, 201);
  });
}

type NewTemplateFile = { name: string; bytes: Uint8Array; type?: string };

/** Stores a template's complete file set as a new immutable version. */
async function addTemplateVersion(blobs: BlobStore, s: Scope, templatePublicId: string, uploads: NewTemplateFile[]) {
  const templateId = uuidOf("template", templatePublicId);
  const [template] = await s.db
    .select()
    .from(documentTemplate)
    .where(visible(documentTemplate, s, templateId));
  if (!template) throw notFound("Template");
  const versionId = newUuid();
  const files: TemplateFile[] = [];
  const names = new Set<string>();
  for (const { name: rawName, bytes, type } of uploads) {
    const name = safeFilename(rawName);
    if (names.has(name)) throw badRequest(`Duplicate file name ${name}`);
    names.add(name);
    const blobKey = blobKeys.templateFile(s.projectId, versionId, name);
    await blobs.put(blobKey, bytes, type || "application/octet-stream");
    files.push({ name, blobKey, size: bytes.byteLength, sha256: sha256(bytes) });
  }
  return s.db.transaction(async (tx) => {
    const [{ next } = { next: 1 }] = await tx
      .select({ next: sql<number>`coalesce(max(${documentTemplateVersion.versionNo}), 0)::int + 1` })
      .from(documentTemplateVersion)
      .where(eq(documentTemplateVersion.templateId, templateId));
    await tx.insert(documentTemplateVersion).values({
      id: versionId,
      projectId: s.projectId,
      templateId,
      versionNo: next,
      files,
      createdBy: s.actor.userId,
    });
    await tx.update(documentTemplate).set({ updatedAt: new Date() }).where(eq(documentTemplate.id, templateId));
    await audit(tx, s, {
      entityType: "templateVersion",
      entityId: versionId,
      op: "create",
      diff: { templateId, files: files.map((f) => f.name) },
    });
    return templateView(tx, template);
  });
}
