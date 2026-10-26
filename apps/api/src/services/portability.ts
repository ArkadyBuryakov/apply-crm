// Project export/import (ADR 0017): versioned JSON plus blobs in a zip, round-trippable, IDs remapped on import.
import {
  action,
  actionAttachment,
  actionEdge,
  actionParticipant,
  actionSubject,
  channel,
  comment,
  contact,
  contactAffiliation,
  contactHandle,
  type Db,
  document,
  documentTemplate,
  documentTemplateVersion,
  documentVersion,
  organization,
  position,
  positionStage,
  project,
  projectMember,
  type TemplateFile,
  type Tx,
  user,
} from "@crm/db";
import { ACTION_TYPES, type ActionType, newUuid } from "@crm/shared";
import { asc, eq } from "drizzle-orm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import { badRequest } from "../http/errors.js";
import { parsePayload } from "./actions.js";
import { type BlobStore, blobKeys } from "./blobs.js";
import { audit, type Scope } from "./core.js";

export const EXPORT_SCHEMA_VERSION = 1;
const MAX_IMPORT_ENTITIES = 50_000;

const ts = z.coerce.date();
const nullableTs = ts.nullable();

const Common = z.object({
  id: z.string(),
  createdAt: ts,
  updatedAt: ts,
  deletedAt: nullableTs,
});

const ExportSchema = z.object({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  exportedAt: ts,
  project: z.object({ name: z.string() }),
  channels: z.array(Common.extend({ name: z.string(), kind: z.string(), url: z.string().nullable() })),
  stages: z.array(
    Common.extend({ key: z.string(), label: z.string(), order: z.int(), suggestOnActionTypes: z.array(z.string()) }),
  ),
  organizations: z.array(
    Common.extend({
      kind: z.enum(["company", "agency"]),
      name: z.string(),
      website: z.string().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  contacts: z.array(
    Common.extend({
      name: z.string(),
      notes: z.string().nullable(),
      affiliations: z.array(
        Common.extend({
          organizationId: z.string(),
          title: z.string().nullable(),
          fromDate: z.string().nullable(),
          toDate: z.string().nullable(),
        }),
      ),
      handles: z.array(Common.extend({ channelId: z.string(), value: z.string() })),
    }),
  ),
  positions: z.array(
    Common.extend({
      title: z.string(),
      companyId: z.string().nullable(),
      agencyId: z.string().nullable(),
      url: z.string().nullable(),
      descriptionMarkdown: z.string().nullable(),
      salaryMin: z.number().nullable(),
      salaryMax: z.number().nullable(),
      salaryCurrency: z.string().nullable(),
      salaryPeriod: z.string().nullable(),
      stageId: z.string(),
      outcome: z.string(),
      sourceChannelId: z.string().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  templates: z.array(
    Common.extend({
      name: z.string(),
      notes: z.string().nullable(),
      versions: z.array(
        z.object({
          id: z.string(),
          versionNo: z.int(),
          createdAt: ts,
          files: z.array(z.object({ name: z.string(), size: z.int(), sha256: z.string(), path: z.string() })),
        }),
      ),
    }),
  ),
  documents: z.array(
    Common.extend({
      kind: z.string(),
      title: z.string(),
      positionId: z.string().nullable(),
      derivedFromVersionId: z.string().nullable(),
      notes: z.string().nullable(),
      versions: z.array(
        z.object({
          id: z.string(),
          versionNo: z.int(),
          filename: z.string(),
          mime: z.string(),
          size: z.int(),
          sha256: z.string(),
          source: z.string().nullable(),
          templateVersionId: z.string().nullable(),
          path: z.string().nullable(),
          pdfPath: z.string().nullable(),
          compileStatus: z.string().nullable(),
          createdAt: ts,
        }),
      ),
    }),
  ),
  actions: z.array(
    Common.extend({
      type: z.enum(ACTION_TYPES),
      status: z.string(),
      title: z.string(),
      notes: z.string().nullable(),
      scheduledAt: nullableTs,
      completedAt: nullableTs,
      dueAt: nullableTs,
      channelId: z.string().nullable(),
      assigneeEmail: z.string().nullable(),
      payload: z.record(z.string(), z.unknown()),
      subjects: z.array(z.object({ positionId: z.string().nullable(), organizationId: z.string().nullable() })),
      participants: z.array(z.object({ contactId: z.string(), role: z.string() })),
      attachments: z.array(z.string()),
    }),
  ),
  edges: z.array(
    z.object({
      parentId: z.string(),
      childId: z.string(),
      kind: z.string(),
      note: z.string().nullable(),
      createdAt: ts,
    }),
  ),
  comments: z.array(
    z.object({
      id: z.string(),
      targetType: z.string(),
      targetId: z.string(),
      authorEmail: z.string().nullable(),
      body: z.string(),
      createdAt: ts,
      editedAt: nullableTs,
      deletedAt: nullableTs,
    }),
  ),
});

export type ProjectExport = z.infer<typeof ExportSchema>;

const common = (r: { id: string; createdAt: Date; updatedAt: Date; deletedAt: Date | null }) => ({
  id: r.id,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  deletedAt: r.deletedAt,
});

/** Builds the export zip: `project.json` plus every stored blob under `blobs/`. */
export async function exportProject(db: Db, blobs: BlobStore, projectId: string): Promise<Uint8Array> {
  const byProject = <T extends { projectId: unknown }>(t: T) => eq(t.projectId as never, projectId);
  const [proj] = await db.select().from(project).where(eq(project.id, projectId));
  const files: Record<string, Uint8Array> = {};
  const addBlob = async (key: string | null) => {
    if (!key) return null;
    const bytes = await blobs.get(key);
    if (!bytes) return null;
    const path = `blobs/${key.replace(/^projects\/[^/]+\//, "")}`;
    files[path] = bytes;
    return path;
  };

  // Users are exported by email (IDs differ between instances); only the project's members are needed.
  const users = new Map(
    (
      await db
        .select({ id: user.id, email: user.email })
        .from(projectMember)
        .innerJoin(user, eq(user.id, projectMember.userId))
        .where(eq(projectMember.organizationId, projectId))
    ).map((u) => [u.id, u.email]),
  );

  const [channels, stages, orgs, contacts, affiliations, handles, positions, actions, subjects, participants] =
    await Promise.all([
      db.select().from(channel).where(byProject(channel)).orderBy(asc(channel.id)),
      db.select().from(positionStage).where(byProject(positionStage)).orderBy(asc(positionStage.id)),
      db.select().from(organization).where(byProject(organization)).orderBy(asc(organization.id)),
      db.select().from(contact).where(byProject(contact)).orderBy(asc(contact.id)),
      db.select().from(contactAffiliation).where(byProject(contactAffiliation)),
      db.select().from(contactHandle).where(byProject(contactHandle)),
      db.select().from(position).where(byProject(position)).orderBy(asc(position.id)),
      db.select().from(action).where(byProject(action)).orderBy(asc(action.id)),
      db.select().from(actionSubject).where(byProject(actionSubject)),
      db.select().from(actionParticipant).where(byProject(actionParticipant)),
    ]);
  const [attachments, edges, templates, templateVersions, documents, versions, comments] = await Promise.all([
    db.select().from(actionAttachment).where(byProject(actionAttachment)),
    db.select().from(actionEdge).where(byProject(actionEdge)),
    db.select().from(documentTemplate).where(byProject(documentTemplate)).orderBy(asc(documentTemplate.id)),
    db.select().from(documentTemplateVersion).where(byProject(documentTemplateVersion)),
    db.select().from(document).where(byProject(document)).orderBy(asc(document.id)),
    db.select().from(documentVersion).where(byProject(documentVersion)),
    db.select().from(comment).where(byProject(comment)),
  ]);

  const data: ProjectExport = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date(),
    project: { name: proj?.name ?? "Project" },
    channels: channels.map((r) => ({ ...common(r), name: r.name, kind: r.kind, url: r.url })),
    stages: stages.map((r) => ({
      ...common(r),
      key: r.key,
      label: r.label,
      order: r.order,
      suggestOnActionTypes: r.suggestOnActionTypes,
    })),
    organizations: orgs.map((r) => ({
      ...common(r),
      kind: r.kind as "company" | "agency",
      name: r.name,
      website: r.website,
      notes: r.notes,
    })),
    contacts: contacts.map((r) => ({
      ...common(r),
      name: r.name,
      notes: r.notes,
      affiliations: affiliations
        .filter((a) => a.contactId === r.id)
        .map((a) => ({
          ...common(a),
          organizationId: a.organizationId,
          title: a.title,
          fromDate: a.fromDate,
          toDate: a.toDate,
        })),
      handles: handles
        .filter((h) => h.contactId === r.id)
        .map((h) => ({ ...common(h), channelId: h.channelId, value: h.value })),
    })),
    positions: positions.map((r) => ({
      ...common(r),
      title: r.title,
      companyId: r.companyId,
      agencyId: r.agencyId,
      url: r.url,
      descriptionMarkdown: r.descriptionMarkdown,
      salaryMin: r.salaryMin,
      salaryMax: r.salaryMax,
      salaryCurrency: r.salaryCurrency,
      salaryPeriod: r.salaryPeriod,
      stageId: r.stageId,
      outcome: r.outcome,
      sourceChannelId: r.sourceChannelId,
      notes: r.notes,
    })),
    templates: [],
    documents: [],
    actions: actions.map((r) => ({
      ...common(r),
      type: r.type as ActionType,
      status: r.status,
      title: r.title,
      notes: r.notes,
      scheduledAt: r.scheduledAt,
      completedAt: r.completedAt,
      dueAt: r.dueAt,
      channelId: r.channelId,
      assigneeEmail: r.assigneeId ? (users.get(r.assigneeId) ?? null) : null,
      payload: r.payload as Record<string, unknown>,
      subjects: subjects
        .filter((s) => s.actionId === r.id)
        .map((s) => ({ positionId: s.positionId, organizationId: s.organizationId })),
      participants: participants
        .filter((p) => p.actionId === r.id)
        .map((p) => ({ contactId: p.contactId, role: p.role })),
      attachments: attachments.filter((a) => a.actionId === r.id).map((a) => a.documentVersionId),
    })),
    edges: edges.map((e) => ({
      parentId: e.parentId,
      childId: e.childId,
      kind: e.kind,
      note: e.note,
      createdAt: e.createdAt,
    })),
    comments: comments.map((c) => ({
      id: c.id,
      targetType: c.targetType,
      targetId: c.targetId,
      authorEmail: c.authorId ? (users.get(c.authorId) ?? null) : null,
      body: c.body,
      createdAt: c.createdAt,
      editedAt: c.editedAt,
      deletedAt: c.deletedAt,
    })),
  };

  for (const t of templates) {
    const tvs = [];
    for (const v of templateVersions.filter((x) => x.templateId === t.id)) {
      const vfiles = [];
      for (const f of v.files) {
        vfiles.push({ name: f.name, size: f.size, sha256: f.sha256, path: (await addBlob(f.blobKey)) ?? "" });
      }
      tvs.push({ id: v.id, versionNo: v.versionNo, createdAt: v.createdAt, files: vfiles });
    }
    data.templates.push({ ...common(t), name: t.name, notes: t.notes, versions: tvs });
  }
  for (const d of documents) {
    const dvs = [];
    for (const v of versions.filter((x) => x.documentId === d.id)) {
      dvs.push({
        id: v.id,
        versionNo: v.versionNo,
        filename: v.filename,
        mime: v.mime,
        size: v.size,
        sha256: v.sha256,
        source: v.source,
        templateVersionId: v.templateVersionId,
        path: await addBlob(v.blobKey),
        pdfPath: await addBlob(v.pdfBlobKey),
        compileStatus: v.compileStatus,
        createdAt: v.createdAt,
      });
    }
    data.documents.push({
      ...common(d),
      kind: d.kind,
      title: d.title,
      positionId: d.positionId,
      derivedFromVersionId: d.derivedFromVersionId,
      notes: d.notes,
      versions: dvs,
    });
  }

  files["project.json"] = strToU8(JSON.stringify(data, null, 2));
  return zipSync(files, { level: 6 });
}

export type ImportSummary = Record<
  | "channels"
  | "stages"
  | "organizations"
  | "contacts"
  | "positions"
  | "actions"
  | "edges"
  | "documents"
  | "templates"
  | "comments",
  number
>;

/**
 * Imports an export zip into an existing project. Every entity gets a new ID; channels and stages are matched to the
 * project's existing ones by name and key. Users are matched by email among the project's members.
 */
export async function importProject(tx: Tx, s: Scope, blobs: BlobStore, zip: Uint8Array): Promise<ImportSummary> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw badRequest("Not a valid zip file");
  }
  const json = entries["project.json"];
  if (!json) throw badRequest("project.json is missing from the archive");
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(json));
  } catch {
    throw badRequest("project.json is not valid JSON");
  }
  const parsed = ExportSchema.safeParse(raw);
  if (!parsed.success)
    throw badRequest("project.json does not match the export format", parsed.error.issues.slice(0, 20));
  const data = parsed.data;
  const total =
    data.organizations.length + data.contacts.length + data.positions.length + data.actions.length + data.edges.length;
  if (total > MAX_IMPORT_ENTITIES) throw badRequest("Archive is too large to import");

  const ids = new Map<string, string>();
  const map = (old: string | null): string | null => {
    if (old === null) return null;
    const mapped = ids.get(old);
    if (!mapped) throw badRequest(`Archive references unknown entity ${old}`);
    return mapped;
  };
  const fresh = (old: string) => {
    const id = newUuid();
    ids.set(old, id);
    return id;
  };
  const owned = { projectId: s.projectId, createdBy: s.actor.userId };
  const summary: ImportSummary = {
    channels: 0,
    stages: 0,
    organizations: 0,
    contacts: 0,
    positions: 0,
    actions: 0,
    edges: 0,
    documents: 0,
    templates: 0,
    comments: 0,
  };

  const members = await tx
    .select({ userId: projectMember.userId, email: user.email })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .where(eq(projectMember.organizationId, s.projectId));
  const memberByEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.userId]));
  const userFor = (email: string | null) => (email ? (memberByEmail.get(email.toLowerCase()) ?? null) : null);

  const existingChannels = await tx.select().from(channel).where(eq(channel.projectId, s.projectId));
  for (const c of data.channels) {
    const match = existingChannels.find((e) => e.name === c.name && !e.deletedAt);
    if (match) {
      ids.set(c.id, match.id);
      continue;
    }
    await tx
      .insert(channel)
      .values({ ...owned, id: fresh(c.id), name: c.name, kind: c.kind, url: c.url, deletedAt: c.deletedAt });
    summary.channels++;
  }
  const existingStages = await tx.select().from(positionStage).where(eq(positionStage.projectId, s.projectId));
  for (const st of data.stages) {
    const match = existingStages.find((e) => e.key === st.key && !e.deletedAt);
    if (match) {
      ids.set(st.id, match.id);
      continue;
    }
    // Deleted stages are kept (deleted) because positions may still point at them; keys are unique only among live ones.
    await tx.insert(positionStage).values({
      ...owned,
      id: fresh(st.id),
      key: st.key,
      label: st.label,
      order: st.order,
      suggestOnActionTypes: st.suggestOnActionTypes,
      deletedAt: st.deletedAt,
    });
    summary.stages++;
  }

  for (const o of data.organizations) {
    await tx.insert(organization).values({
      ...owned,
      id: fresh(o.id),
      kind: o.kind,
      name: o.name,
      website: o.website,
      notes: o.notes,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      deletedAt: o.deletedAt,
    });
    summary.organizations++;
  }
  for (const c of data.contacts) {
    const contactId = fresh(c.id);
    await tx.insert(contact).values({
      ...owned,
      id: contactId,
      name: c.name,
      notes: c.notes,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      deletedAt: c.deletedAt,
    });
    for (const a of c.affiliations) {
      await tx.insert(contactAffiliation).values({
        ...owned,
        id: fresh(a.id),
        contactId,
        organizationId: map(a.organizationId)!,
        title: a.title,
        fromDate: a.fromDate,
        toDate: a.toDate,
        deletedAt: a.deletedAt,
      });
    }
    for (const h of c.handles) {
      await tx.insert(contactHandle).values({
        ...owned,
        id: fresh(h.id),
        contactId,
        channelId: map(h.channelId)!,
        value: h.value,
        deletedAt: h.deletedAt,
      });
    }
    summary.contacts++;
  }
  for (const p of data.positions) {
    await tx.insert(position).values({
      ...owned,
      id: fresh(p.id),
      title: p.title,
      companyId: map(p.companyId),
      agencyId: map(p.agencyId),
      url: p.url,
      descriptionMarkdown: p.descriptionMarkdown,
      salaryMin: p.salaryMin,
      salaryMax: p.salaryMax,
      salaryCurrency: p.salaryCurrency,
      salaryPeriod: p.salaryPeriod,
      stageId: map(p.stageId)!,
      outcome: p.outcome,
      sourceChannelId: map(p.sourceChannelId),
      notes: p.notes,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      deletedAt: p.deletedAt,
    });
    summary.positions++;
  }

  const readBlob = (path: string | null) => {
    if (!path) return null;
    const bytes = entries[path];
    if (!bytes) throw badRequest(`${path} is missing from the archive`);
    return bytes;
  };
  for (const t of data.templates) {
    const templateId = fresh(t.id);
    await tx
      .insert(documentTemplate)
      .values({ ...owned, id: templateId, name: t.name, notes: t.notes, deletedAt: t.deletedAt });
    for (const v of t.versions) {
      const versionId = fresh(v.id);
      const files: TemplateFile[] = [];
      for (const f of v.files) {
        const key = blobKeys.templateFile(s.projectId, versionId, f.name);
        await blobs.put(key, readBlob(f.path)!, "application/octet-stream");
        files.push({ name: f.name, blobKey: key, size: f.size, sha256: f.sha256 });
      }
      await tx.insert(documentTemplateVersion).values({
        id: versionId,
        projectId: s.projectId,
        templateId,
        versionNo: v.versionNo,
        files,
        createdAt: v.createdAt,
        createdBy: s.actor.userId,
      });
    }
    summary.templates++;
  }
  // Documents may derive from versions of other documents, so allocate all version IDs first.
  for (const d of data.documents) for (const v of d.versions) fresh(v.id);
  for (const d of data.documents) {
    const documentId = fresh(d.id);
    await tx.insert(document).values({
      ...owned,
      id: documentId,
      kind: d.kind,
      title: d.title,
      positionId: map(d.positionId),
      derivedFromVersionId: map(d.derivedFromVersionId),
      notes: d.notes,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      deletedAt: d.deletedAt,
    });
    for (const v of d.versions) {
      const versionId = map(v.id)!;
      const blob = readBlob(v.path);
      const pdf = readBlob(v.pdfPath);
      const blobKey = blob ? blobKeys.upload(s.projectId, versionId, v.filename) : null;
      const pdfKey = pdf ? blobKeys.pdf(s.projectId, versionId) : null;
      if (blob && blobKey) await blobs.put(blobKey, blob, v.mime);
      if (pdf && pdfKey) await blobs.put(pdfKey, pdf, "application/pdf");
      await tx.insert(documentVersion).values({
        id: versionId,
        projectId: s.projectId,
        documentId,
        versionNo: v.versionNo,
        blobKey,
        filename: v.filename,
        mime: v.mime,
        size: v.size,
        sha256: v.sha256,
        source: v.source,
        templateVersionId: map(v.templateVersionId),
        pdfBlobKey: pdfKey,
        compileStatus: v.compileStatus,
        createdAt: v.createdAt,
        createdBy: s.actor.userId,
      });
    }
    summary.documents++;
  }

  for (const a of data.actions) {
    const actionId = fresh(a.id);
    await tx.insert(action).values({
      ...owned,
      id: actionId,
      type: a.type,
      status: a.status,
      title: a.title,
      notes: a.notes,
      scheduledAt: a.scheduledAt,
      completedAt: a.completedAt,
      dueAt: a.dueAt,
      channelId: map(a.channelId),
      assigneeId: userFor(a.assigneeEmail) ?? s.actor.userId,
      payload: parsePayload(a.type, a.payload),
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      deletedAt: a.deletedAt,
    });
    for (const subj of a.subjects) {
      await tx.insert(actionSubject).values({
        id: newUuid(),
        projectId: s.projectId,
        actionId,
        positionId: map(subj.positionId),
        organizationId: map(subj.organizationId),
      });
    }
    for (const p of a.participants) {
      await tx
        .insert(actionParticipant)
        .values({ projectId: s.projectId, actionId, contactId: map(p.contactId)!, role: p.role })
        .onConflictDoNothing();
    }
    for (const versionId of a.attachments) {
      await tx
        .insert(actionAttachment)
        .values({ projectId: s.projectId, actionId, documentVersionId: map(versionId)! });
    }
    summary.actions++;
  }
  for (const e of data.edges) {
    await tx
      .insert(actionEdge)
      .values({
        projectId: s.projectId,
        parentId: map(e.parentId)!,
        childId: map(e.childId)!,
        kind: e.kind,
        note: e.note,
        createdAt: e.createdAt,
        createdBy: s.actor.userId,
      })
      .onConflictDoNothing();
    summary.edges++;
  }
  for (const c of data.comments) {
    await tx.insert(comment).values({
      id: newUuid(),
      projectId: s.projectId,
      targetType: c.targetType,
      targetId: map(c.targetId)!,
      authorId: userFor(c.authorEmail) ?? s.actor.userId,
      body: c.body,
      createdAt: c.createdAt,
      editedAt: c.editedAt,
      deletedAt: c.deletedAt,
    });
    summary.comments++;
  }

  await audit(tx, s, { entityType: "project", entityId: s.projectId, op: "create", diff: { imported: summary } });
  return summary;
}
