// Project-scoped data access helpers (ADR 0003, 0012): tenancy filter, audit, optimistic concurrency, soft delete.
import { auditEvent, type Db, type Tx } from "@crm/db";
import { decodeToUuid, encodeUuid, type IdKind, newUuid } from "@crm/shared";
import { and, eq, isNull, lt, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { ApiError, badRequest, notFound } from "../http/errors.js";
import type { Actor } from "../http/types.js";

export type Scope = {
  db: Db;
  actor: Actor;
  projectId: string;
};

export type AuditOp = "create" | "update" | "delete" | "restore" | "purge" | "link" | "unlink";

export async function audit(
  tx: Tx,
  scope: Scope,
  entry: { entityType: string; entityId: string; op: AuditOp; diff?: unknown },
): Promise<void> {
  await tx.insert(auditEvent).values({
    id: newUuid(),
    projectId: scope.projectId,
    actorUserId: scope.actor.userId,
    via: scope.actor.via,
    entityType: entry.entityType,
    entityId: entry.entityId,
    op: entry.op,
    diff: entry.diff ?? null,
  });
}

/** Columns every versioned entity table has (see `entityColumns` in the db schema). */
type VersionedTable = PgTable & {
  id: AnyPgColumn;
  projectId: AnyPgColumn;
  version: AnyPgColumn;
  updatedAt: AnyPgColumn;
  deletedAt: AnyPgColumn;
};

export function visible(table: VersionedTable, scope: Pick<Scope, "projectId">, id?: string): SQL {
  const conditions = [eq(table.projectId, scope.projectId), isNull(table.deletedAt)];
  if (id) conditions.push(eq(table.id, id));
  return and(...conditions)!;
}

/** Fields that changed between two snapshots, for audit diffs. */
export function changes(before: Record<string, unknown>, after: Record<string, unknown>) {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (key === "version" || key === "updatedAt" || key === "search") continue;
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) diff[key] = { from: a, to: b };
  }
  return diff;
}

/**
 * Updates an entity if its version matches, bumping the version. Throws 404 when it does not exist (or is deleted)
 * and 412 with the current row when someone else changed it first.
 */
export async function updateVersioned<T extends VersionedTable, Row extends Record<string, unknown>>(
  tx: Tx,
  table: T,
  scope: Pick<Scope, "projectId">,
  args: { id: string; expectedVersion: number; set: Record<string, unknown>; entityName: string },
): Promise<{ before: Row; after: Row }> {
  const [before] = (await tx
    .select()
    .from(table as PgTable)
    .where(visible(table, scope, args.id))
    .for("update")) as Row[];
  if (!before) throw notFound(args.entityName);
  if (before.version !== args.expectedVersion) {
    throw new ApiError(412, `${args.entityName} was changed by someone else`, { currentVersion: before.version });
  }
  const [after] = (await tx
    .update(table)
    .set({ ...args.set, version: sql`${table.version} + 1`, updatedAt: new Date() } as never)
    .where(visible(table, scope, args.id))
    .returning()) as Row[];
  return { before, after: after! };
}

export async function softDelete<T extends VersionedTable>(
  tx: Tx,
  table: T,
  scope: Scope,
  args: { id: string; expectedVersion: number; entityName: string; entityType: string },
): Promise<void> {
  const { before } = await updateVersioned(tx, table, scope, {
    id: args.id,
    expectedVersion: args.expectedVersion,
    set: { deletedAt: new Date() },
    entityName: args.entityName,
  });
  await audit(tx, scope, { entityType: args.entityType, entityId: args.id, op: "delete", diff: { before } });
}

export async function restore<T extends VersionedTable>(
  tx: Tx,
  table: T,
  scope: Scope,
  args: { id: string; entityName: string; entityType: string },
): Promise<void> {
  const rows = await tx
    .update(table)
    .set({ deletedAt: null, version: sql`${table.version} + 1`, updatedAt: new Date() } as never)
    .where(and(eq(table.projectId, scope.projectId), eq(table.id, args.id)))
    .returning({ id: table.id });
  if (rows.length === 0) throw notFound(args.entityName);
  await audit(tx, scope, { entityType: args.entityType, entityId: args.id, op: "restore" });
}

export async function requireVisible(
  tx: Tx,
  table: VersionedTable,
  scope: Pick<Scope, "projectId">,
  id: string,
  entityName: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: table.id })
    .from(table as PgTable)
    .where(visible(table, scope, id))
    .limit(1);
  if (!row) throw notFound(entityName);
}

// ---------------------------------------------------------------------------
// Cursor pagination over UUIDv7 primary keys (newest first)

export function cursorCondition(idColumn: AnyPgColumn, cursor: string | undefined): SQL | undefined {
  if (!cursor) return undefined;
  const uuid = decodeToUuid(cursor);
  if (!uuid) throw badRequest("Invalid cursor");
  return lt(idColumn, uuid);
}

export function nextCursor<R extends { id: string }>(
  rows: R[],
  limit: number,
): { items: R[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: encodeUuid(items[items.length - 1]!.id) };
}

export type { IdKind };
