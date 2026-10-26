// Action logic shared by the action routes, logInteraction and import (ADR 0004, 0013, 0014, 0029).
import {
  action,
  actionAttachment,
  actionEdge,
  actionParticipant,
  actionSubject,
  channel,
  contact,
  documentVersion,
  notification,
  organization,
  position,
  positionStage,
  projectMember,
  type Tx,
} from "@crm/db";
import {
  ACTION_PAYLOAD_SCHEMAS,
  type ActionStatus,
  type ActionType,
  ALLOWED_STATUSES,
  canReschedule,
  defaultStatusFor,
  newUuid,
  type ParticipantRole,
} from "@crm/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import { ApiError, badRequest, notFound } from "../http/errors.js";
import { uuidOf } from "../http/route.js";
import { iso, isoOrNull, pid, pidOrNull } from "../http/serialize.js";
import { audit, changes, requireVisible, type Scope, updateVersioned, visible } from "./core.js";

export type SubjectRef = { positionId?: string | undefined; organizationId?: string | undefined };
export type ParticipantRef = { contactId: string; role: ParticipantRole };

/** Fields shared by create and update, with public IDs. */
export type ActionFields = {
  title?: string | undefined;
  notes?: string | null | undefined;
  status?: ActionStatus | undefined;
  scheduledAt?: string | null | undefined;
  completedAt?: string | null | undefined;
  dueAt?: string | null | undefined;
  channelId?: string | null | undefined;
  assigneeId?: string | null | undefined;
  subjects?: SubjectRef[] | undefined;
  participants?: ParticipantRef[] | undefined;
  attachments?: string[] | undefined;
};

export type CreateActionInput = ActionFields & {
  type: ActionType;
  title: string;
  payload?: Record<string, unknown> | undefined;
};

export type Suggestion = {
  positionId: string;
  kind: "stage" | "outcome";
  stageId?: string;
  stageKey?: string;
  outcome?: "rejected";
  reason: string;
};

type ActionRow = typeof action.$inferSelect;

export function parsePayload(type: ActionType, payload: unknown) {
  const schema: z.ZodType = ACTION_PAYLOAD_SCHEMAS[type];
  const result = schema.safeParse(payload ?? {});
  if (!result.success) {
    throw new ApiError(422, `Invalid ${type.replace("_", " ")} details`, result.error.issues);
  }
  return result.data as Record<string, unknown>;
}

function checkStatus(type: ActionType, status: ActionStatus) {
  if (!ALLOWED_STATUSES[type].includes(status)) {
    throw badRequest(
      `Status ${status} is not allowed for ${type.replace("_", " ")} actions; allowed: ${ALLOWED_STATUSES[type].join(", ")}`,
    );
  }
}

const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

async function resolveAssignee(tx: Tx, s: Scope, assigneeId: string | null | undefined) {
  if (assigneeId === undefined || assigneeId === null) return assigneeId;
  const userId = uuidOf("user", assigneeId);
  const [member] = await tx
    .select({ id: projectMember.id })
    .from(projectMember)
    .where(and(eq(projectMember.organizationId, s.projectId), eq(projectMember.userId, userId)));
  if (!member) throw badRequest("The assignee is not a member of this project");
  return userId;
}

async function replaceSubjects(tx: Tx, s: Scope, actionId: string, subjects: SubjectRef[]) {
  await tx.delete(actionSubject).where(eq(actionSubject.actionId, actionId));
  const seen = new Set<string>();
  for (const subject of subjects) {
    const positionId = subject.positionId ? uuidOf("position", subject.positionId) : null;
    const organizationId = subject.organizationId ? uuidOf("organization", subject.organizationId) : null;
    if ((positionId === null) === (organizationId === null)) {
      throw badRequest("Each subject needs exactly one of positionId or organizationId");
    }
    const key = positionId ?? organizationId!;
    if (seen.has(key)) continue;
    seen.add(key);
    if (positionId) await requireVisible(tx, position, s, positionId, "Position");
    if (organizationId) await requireVisible(tx, organization, s, organizationId, "Organization");
    await tx
      .insert(actionSubject)
      .values({ id: newUuid(), projectId: s.projectId, actionId, positionId, organizationId });
  }
}

async function replaceParticipants(tx: Tx, s: Scope, actionId: string, participants: ParticipantRef[]) {
  await tx.delete(actionParticipant).where(eq(actionParticipant.actionId, actionId));
  const seen = new Set<string>();
  for (const p of participants) {
    const contactId = uuidOf("contact", p.contactId);
    const key = `${contactId}:${p.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await requireVisible(tx, contact, s, contactId, "Contact");
    await tx.insert(actionParticipant).values({ projectId: s.projectId, actionId, contactId, role: p.role });
  }
}

async function replaceAttachments(tx: Tx, s: Scope, actionId: string, versionIds: string[]) {
  await tx.delete(actionAttachment).where(eq(actionAttachment.actionId, actionId));
  for (const publicVersionId of new Set(versionIds)) {
    const documentVersionId = uuidOf("documentVersion", publicVersionId);
    const [found] = await tx
      .select({ id: documentVersion.id })
      .from(documentVersion)
      .where(and(eq(documentVersion.projectId, s.projectId), eq(documentVersion.id, documentVersionId)));
    if (!found) throw notFound("Document version");
    await tx.insert(actionAttachment).values({ projectId: s.projectId, actionId, documentVersionId });
  }
}

async function notifyAssignee(
  tx: Tx,
  s: Scope,
  actionId: string,
  assigneeId: string | null | undefined,
  title: string,
) {
  if (!assigneeId || assigneeId === s.actor.userId) return;
  await tx.insert(notification).values({
    id: newUuid(),
    projectId: s.projectId,
    userId: assigneeId,
    kind: "assigned",
    entityType: "action",
    entityId: actionId,
    message: `${s.actor.name} assigned you: ${title}`,
  });
}

async function writeRelations(tx: Tx, s: Scope, actionId: string, fields: ActionFields) {
  if (fields.subjects) await replaceSubjects(tx, s, actionId, fields.subjects);
  if (fields.participants) await replaceParticipants(tx, s, actionId, fields.participants);
  if (fields.attachments) await replaceAttachments(tx, s, actionId, fields.attachments);
}

export async function createAction(
  tx: Tx,
  s: Scope,
  input: CreateActionInput,
): Promise<{ id: string; suggestions: Suggestion[] }> {
  const status = input.status ?? defaultStatusFor(input.type);
  checkStatus(input.type, status);
  const payload = parsePayload(input.type, input.payload);
  const channelId = input.channelId ? uuidOf("channel", input.channelId) : null;
  if (channelId) await requireVisible(tx, channel, s, channelId, "Channel");
  const assigneeId = (await resolveAssignee(tx, s, input.assigneeId)) ?? s.actor.userId;
  const id = newUuid();
  await tx.insert(action).values({
    id,
    projectId: s.projectId,
    type: input.type,
    status,
    title: input.title,
    notes: input.notes ?? null,
    scheduledAt: toDate(input.scheduledAt) ?? null,
    completedAt: toDate(input.completedAt) ?? (status === "done" ? new Date() : null),
    dueAt: toDate(input.dueAt) ?? null,
    channelId,
    assigneeId,
    payload,
    createdBy: s.actor.userId,
  });
  await writeRelations(tx, s, id, input);
  if (input.type === "rejection" && payload.stageKey === undefined) {
    await fillRejectionStage(tx, s, id, payload);
  }
  await audit(tx, s, { entityType: "action", entityId: id, op: "create", diff: { after: input } });
  await notifyAssignee(tx, s, id, assigneeId, input.title);
  return { id, suggestions: status === "done" ? await suggestionsFor(tx, s, id, input.type) : [] };
}

/** Records the stage the position was at when the rejection came in (ADR 0029). */
async function fillRejectionStage(tx: Tx, s: Scope, actionId: string, payload: Record<string, unknown>) {
  const positions = await tx
    .select({ stageKey: positionStage.key })
    .from(actionSubject)
    .innerJoin(position, eq(position.id, actionSubject.positionId))
    .innerJoin(positionStage, eq(positionStage.id, position.stageId))
    .where(eq(actionSubject.actionId, actionId));
  if (positions.length !== 1) return;
  await tx
    .update(action)
    .set({ payload: { ...payload, stageKey: positions[0]!.stageKey } })
    .where(and(eq(action.projectId, s.projectId), eq(action.id, actionId)));
}

export async function updateAction(
  tx: Tx,
  s: Scope,
  id: string,
  expectedVersion: number,
  input: ActionFields & { payload?: Record<string, unknown> | undefined },
): Promise<{ suggestions: Suggestion[] }> {
  const [current] = await tx
    .select()
    .from(action)
    .where(visible(action, s, id));
  if (!current) throw notFound("Action");
  const type = current.type as ActionType;
  const set: Partial<typeof action.$inferInsert> = {};
  if (input.title !== undefined) set.title = input.title;
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.status !== undefined) {
    checkStatus(type, input.status);
    set.status = input.status;
    if (input.status === "done" && !current.completedAt && input.completedAt === undefined)
      set.completedAt = new Date();
  }
  if (input.scheduledAt !== undefined) set.scheduledAt = toDate(input.scheduledAt);
  if (input.completedAt !== undefined) set.completedAt = toDate(input.completedAt);
  if (input.dueAt !== undefined) set.dueAt = toDate(input.dueAt);
  if (input.channelId !== undefined) {
    set.channelId = input.channelId ? uuidOf("channel", input.channelId) : null;
    if (set.channelId) await requireVisible(tx, channel, s, set.channelId, "Channel");
  }
  if (input.assigneeId !== undefined) set.assigneeId = await resolveAssignee(tx, s, input.assigneeId);
  if (input.payload !== undefined) {
    set.payload = parsePayload(type, { ...(current.payload as Record<string, unknown>), ...input.payload });
  }
  const { before, after } = await updateVersioned<typeof action, ActionRow>(tx, action, s, {
    id,
    expectedVersion,
    set,
    entityName: "Action",
  });
  await writeRelations(tx, s, id, input);
  await audit(tx, s, {
    entityType: "action",
    entityId: id,
    op: "update",
    diff: {
      ...changes(before, after),
      ...(input.subjects ? { subjects: input.subjects } : {}),
      ...(input.participants ? { participants: input.participants } : {}),
      ...(input.attachments ? { attachments: input.attachments } : {}),
    },
  });
  if (set.assigneeId && set.assigneeId !== current.assigneeId) {
    await notifyAssignee(tx, s, id, set.assigneeId, after.title);
  }
  const becameDone = after.status === "done" && before.status !== "done";
  return { suggestions: becameDone ? await suggestionsFor(tx, s, id, type) : [] };
}

/**
 * Stage and outcome suggestions for the action's positions (ADR 0014): a done action whose type is listed on a stage
 * suggests moving the position there; a rejection suggests outcome `rejected`. Nothing is applied automatically.
 */
export async function suggestionsFor(tx: Tx, s: Scope, actionId: string, type: ActionType): Promise<Suggestion[]> {
  const positions = await tx
    .select({ id: position.id, stageId: position.stageId, outcome: position.outcome })
    .from(actionSubject)
    .innerJoin(position, eq(position.id, actionSubject.positionId))
    .where(and(eq(actionSubject.actionId, actionId), isNull(position.deletedAt)));
  if (positions.length === 0) return [];
  const suggestions: Suggestion[] = [];
  if (type === "rejection") {
    for (const p of positions) {
      if (p.outcome !== "rejected") {
        suggestions.push({
          positionId: pid("position", p.id),
          kind: "outcome",
          outcome: "rejected",
          reason: "A rejection was logged",
        });
      }
    }
    return suggestions;
  }
  const stages = await tx.select().from(positionStage).where(visible(positionStage, s));
  const target = stages.filter((st) => st.suggestOnActionTypes.includes(type)).sort((a, b) => a.order - b.order)[0];
  if (!target) return [];
  for (const p of positions) {
    const currentOrder = stages.find((st) => st.id === p.stageId)?.order ?? -1;
    // Only suggest moving forward; a late-logged application should not pull a position back from "offer".
    if (p.stageId !== target.id && currentOrder < target.order && p.outcome === "open") {
      suggestions.push({
        positionId: pid("position", p.id),
        kind: "stage",
        stageId: pid("stage", target.id),
        stageKey: target.key,
        reason: `A ${type.replace("_", " ")} was completed`,
      });
    }
  }
  return suggestions;
}

/**
 * Reschedules a planned action (ADR 0004): the original becomes `rescheduled` and a new planned copy is linked to it
 * with a `rescheduled` edge. Returns the new action's id.
 */
export async function rescheduleAction(
  tx: Tx,
  s: Scope,
  id: string,
  expectedVersion: number,
  input: {
    scheduledAt?: string | null | undefined;
    dueAt?: string | null | undefined;
    notes?: string | null | undefined;
  },
) {
  const [current] = await tx
    .select()
    .from(action)
    .where(visible(action, s, id));
  if (!current) throw notFound("Action");
  const type = current.type as ActionType;
  if (!canReschedule(type)) throw badRequest(`${type.replace("_", " ")} actions cannot be rescheduled`);
  if (current.status !== "planned") throw badRequest("Only planned actions can be rescheduled");
  if (input.scheduledAt === undefined && input.dueAt === undefined) {
    throw badRequest("Give a new scheduledAt or dueAt");
  }
  await updateVersioned(tx, action, s, { id, expectedVersion, set: { status: "rescheduled" }, entityName: "Action" });

  const newId = newUuid();
  await tx.insert(action).values({
    id: newId,
    projectId: s.projectId,
    type: current.type,
    status: "planned",
    title: current.title,
    notes: input.notes === undefined ? current.notes : input.notes,
    scheduledAt: input.scheduledAt === undefined ? current.scheduledAt : toDate(input.scheduledAt),
    dueAt: input.dueAt === undefined ? current.dueAt : toDate(input.dueAt),
    channelId: current.channelId,
    assigneeId: current.assigneeId,
    payload: current.payload,
    createdBy: s.actor.userId,
  });
  const subjects = await tx.select().from(actionSubject).where(eq(actionSubject.actionId, id));
  for (const subj of subjects) {
    await tx.insert(actionSubject).values({ ...subj, id: newUuid(), actionId: newId });
  }
  const participants = await tx.select().from(actionParticipant).where(eq(actionParticipant.actionId, id));
  for (const p of participants) await tx.insert(actionParticipant).values({ ...p, actionId: newId });
  await tx.insert(actionEdge).values({
    projectId: s.projectId,
    parentId: id,
    childId: newId,
    kind: "rescheduled",
    createdBy: s.actor.userId,
  });
  await audit(tx, s, {
    entityType: "action",
    entityId: id,
    op: "update",
    diff: { status: { from: "planned", to: "rescheduled" }, rescheduledTo: newId },
  });
  await audit(tx, s, { entityType: "action", entityId: newId, op: "create", diff: { rescheduledFrom: id, ...input } });
  return newId;
}

// ---------------------------------------------------------------------------
// Reading

export async function loadActions(tx: Tx, rows: ActionRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [subjects, participants, attachments] = await Promise.all([
    tx.select().from(actionSubject).where(inArray(actionSubject.actionId, ids)),
    tx
      .select({ p: actionParticipant, name: contact.name })
      .from(actionParticipant)
      .innerJoin(contact, eq(contact.id, actionParticipant.contactId))
      .where(inArray(actionParticipant.actionId, ids)),
    tx.select().from(actionAttachment).where(inArray(actionAttachment.actionId, ids)),
  ]);
  return rows.map((r) =>
    actionView(r, {
      subjects: subjects.filter((x) => x.actionId === r.id),
      participants: participants.filter((x) => x.p.actionId === r.id),
      attachments: attachments.filter((x) => x.actionId === r.id),
    }),
  );
}

export function actionView(
  r: ActionRow,
  rel: {
    subjects: (typeof actionSubject.$inferSelect)[];
    participants: { p: typeof actionParticipant.$inferSelect; name: string }[];
    attachments: (typeof actionAttachment.$inferSelect)[];
  },
) {
  return {
    id: pid("action", r.id),
    type: r.type as ActionType,
    status: r.status as ActionStatus,
    title: r.title,
    notes: r.notes,
    scheduledAt: isoOrNull(r.scheduledAt),
    completedAt: isoOrNull(r.completedAt),
    dueAt: isoOrNull(r.dueAt),
    channelId: pidOrNull("channel", r.channelId),
    assigneeId: pidOrNull("user", r.assigneeId),
    payload: r.payload as Record<string, unknown>,
    subjects: rel.subjects.map((x) =>
      x.positionId
        ? { positionId: pid("position", x.positionId) }
        : { organizationId: pid("organization", x.organizationId!) },
    ),
    participants: rel.participants.map((x) => ({
      contactId: pid("contact", x.p.contactId),
      contactName: x.name,
      role: x.p.role as ParticipantRole,
    })),
    attachments: rel.attachments.map((x) => pid("documentVersion", x.documentVersionId)),
    version: r.version,
    createdBy: pidOrNull("user", r.createdBy),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    deletedAt: isoOrNull(r.deletedAt),
  };
}

export async function loadAction(tx: Tx, s: Scope, id: string) {
  const [row] = await tx
    .select()
    .from(action)
    .where(visible(action, s, id));
  if (!row) throw notFound("Action");
  return (await loadActions(tx, [row]))[0]!;
}
