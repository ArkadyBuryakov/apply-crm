// Action graph (ADR 0005): typed parent → child edges, cycles allowed but reported, traversals cycle-safe.
import { action, actionEdge, type Tx } from "@crm/db";
import type { EdgeKind } from "@crm/shared";
import { and, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { badRequest, conflict, notFound } from "../http/errors.js";
import { iso, pid } from "../http/serialize.js";
import { audit, requireVisible, type Scope } from "./core.js";

export const MAX_DEPTH = 20;

type EdgeRow = typeof actionEdge.$inferSelect;

export const edgeView = (e: EdgeRow) => ({
  parentId: pid("action", e.parentId),
  childId: pid("action", e.childId),
  kind: e.kind as EdgeKind,
  note: e.note,
  createdAt: iso(e.createdAt),
});

/** True when `to` can be reached from `from` along edges between non-deleted actions. */
export async function reachable(tx: Tx, from: string, to: string): Promise<boolean> {
  const rows = await tx.execute(sql`
    with recursive reach(id, path) as (
      select ${from}::uuid, array[${from}::uuid]
      union all
      select e.child_id, r.path || e.child_id
      from ${actionEdge} e
      join reach r on e.parent_id = r.id
      join ${action} a on a.id = e.child_id and a.deleted_at is null
      where not e.child_id = any(r.path)
    )
    select 1 as found from reach where id = ${to}::uuid limit 1
  `);
  return rows.length > 0;
}

export async function addEdge(
  tx: Tx,
  s: Scope,
  input: { parentId: string; childId: string; kind: EdgeKind; note?: string | null | undefined },
): Promise<{ edge: ReturnType<typeof edgeView>; warnings: string[] }> {
  if (input.parentId === input.childId) throw badRequest("An action cannot link to itself");
  await requireVisible(tx, action, s, input.parentId, "Parent action");
  await requireVisible(tx, action, s, input.childId, "Child action");
  const [existing] = await tx
    .select()
    .from(actionEdge)
    .where(
      and(
        eq(actionEdge.parentId, input.parentId),
        eq(actionEdge.childId, input.childId),
        eq(actionEdge.kind, input.kind),
      ),
    );
  if (existing) throw conflict("This edge already exists", edgeView(existing));
  // Cycles are allowed (ADR 0005) but reported, so callers can tell the user.
  const closesCycle = await reachable(tx, input.childId, input.parentId);
  const [row] = await tx
    .insert(actionEdge)
    .values({
      projectId: s.projectId,
      parentId: input.parentId,
      childId: input.childId,
      kind: input.kind,
      note: input.note ?? null,
      createdBy: s.actor.userId,
    })
    .returning();
  await audit(tx, s, {
    entityType: "edge",
    entityId: `${input.parentId}:${input.childId}:${input.kind}`,
    op: "link",
    diff: { parentId: input.parentId, childId: input.childId, kind: input.kind, note: input.note ?? null },
  });
  return { edge: edgeView(row!), warnings: closesCycle ? ["cycle"] : [] };
}

export async function removeEdge(tx: Tx, s: Scope, parentId: string, childId: string, kind: EdgeKind) {
  const rows = await tx
    .delete(actionEdge)
    .where(
      and(
        eq(actionEdge.projectId, s.projectId),
        eq(actionEdge.parentId, parentId),
        eq(actionEdge.childId, childId),
        eq(actionEdge.kind, kind),
      ),
    )
    .returning();
  if (rows.length === 0) throw notFound("Edge");
  await audit(tx, s, { entityType: "edge", entityId: `${parentId}:${childId}:${kind}`, op: "unlink", diff: rows[0] });
}

/**
 * Collects actions reachable from `start` (descendants, ancestors or both) up to `maxDepth` edges away, never
 * revisiting a node on the same path, so cycles terminate. Returns node ids with their distance.
 */
export async function walk(
  tx: Tx,
  start: string,
  direction: "descendants" | "ancestors" | "both",
  maxDepth: number,
): Promise<Map<string, number>> {
  const depth = Math.min(Math.max(maxDepth, 0), MAX_DEPTH);
  const result = new Map<string, number>([[start, 0]]);
  const run = async (from: "parent_id" | "child_id", to: "parent_id" | "child_id") => {
    const rows = (await tx.execute(sql`
      with recursive walk(id, depth, path) as (
        select ${start}::uuid, 0, array[${start}::uuid]
        union all
        select e.${sql.raw(to)}, w.depth + 1, w.path || e.${sql.raw(to)}
        from ${actionEdge} e
        join walk w on e.${sql.raw(from)} = w.id
        join ${action} a on a.id = e.${sql.raw(to)} and a.deleted_at is null
        where w.depth < ${depth} and not e.${sql.raw(to)} = any(w.path)
      )
      select id::text as id, min(depth)::int as depth from walk group by id
    `)) as unknown as { id: string; depth: number }[];
    for (const r of rows) result.set(r.id, Math.min(result.get(r.id) ?? r.depth, r.depth));
  };
  if (direction !== "ancestors") await run("parent_id", "child_id");
  if (direction !== "descendants") await run("child_id", "parent_id");
  return result;
}

/** Edges whose both ends are in `ids` and not deleted. */
export async function edgesAmong(tx: Tx, s: Scope, ids: string[]) {
  if (ids.length === 0) return [];
  const parent = alias(action, "parent");
  const child = alias(action, "child");
  const rows = await tx
    .select({ e: actionEdge })
    .from(actionEdge)
    .innerJoin(parent, eq(parent.id, actionEdge.parentId))
    .innerJoin(child, eq(child.id, actionEdge.childId))
    .where(
      and(
        eq(actionEdge.projectId, s.projectId),
        inArray(actionEdge.parentId, ids),
        inArray(actionEdge.childId, ids),
        isNull(parent.deletedAt),
        isNull(child.deletedAt),
      ),
    );
  return rows.map((r) => edgeView(r.e));
}

/** True when some node at the depth limit has edges to non-deleted actions outside the collected set. */
export async function truncatedAt(tx: Tx, nodes: Map<string, number>, maxDepth: number) {
  const frontier = [...nodes.entries()].filter(([, d]) => d >= maxDepth).map(([id]) => id);
  if (frontier.length === 0) return false;
  const all = [...nodes.keys()];
  const far = alias(action, "far");
  const [row] = await tx
    .select({ found: sql<number>`1` })
    .from(actionEdge)
    .innerJoin(
      far,
      or(
        and(eq(far.id, actionEdge.childId), inArray(actionEdge.parentId, frontier)),
        and(eq(far.id, actionEdge.parentId), inArray(actionEdge.childId, frontier)),
      ),
    )
    .where(and(isNull(far.deletedAt), notInArray(far.id, all)))
    .limit(1);
  return Boolean(row);
}
