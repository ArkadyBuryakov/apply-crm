// Morning agenda digest (ADR 0016, 0024): a worker cron job tells each member how many of their actions are on today's
// agenda. It runs every 10 minutes and fires once per member and project during the 8 o'clock hour in their timezone.
import { action, type Db, notification, projectMember, user } from "@crm/db";
import { newUuid } from "@crm/shared";
import { and, count, eq, isNull, notExists, sql } from "drizzle-orm";

const DIGEST_HOUR = 8;

/** Writes the digest notifications that are due at `now` and returns how many it wrote. Safe to run repeatedly. */
export async function runAgendaDigest(db: Db, now = new Date()): Promise<number> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const local = sql`(${at} at time zone ${user.timezone})`;
  const today = sql`${local}::date`;
  // Same "today" as getAgenda: started on or before today and not due before today.
  const startDay = sql`(coalesce(${action.scheduledAt}, ${action.dueAt}) at time zone ${user.timezone})::date`;
  const dueDay = sql`(coalesce(${action.dueAt}, ${action.scheduledAt}) at time zone ${user.timezone})::date`;

  const due = await db
    .select({ projectId: projectMember.organizationId, userId: user.id, tasks: count(action.id) })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .innerJoin(
      action,
      and(
        eq(action.projectId, projectMember.organizationId),
        eq(action.assigneeId, user.id),
        eq(action.status, "planned"),
        isNull(action.deletedAt),
        sql`${startDay} <= ${today}`,
        sql`${dueDay} >= ${today}`,
      ),
    )
    .where(
      and(
        sql`extract(hour from ${local}) = ${DIGEST_HOUR}`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(notification)
            .where(
              and(
                eq(notification.projectId, projectMember.organizationId),
                eq(notification.userId, user.id),
                eq(notification.kind, "agenda"),
                sql`(${notification.createdAt} at time zone ${user.timezone})::date = ${today}`,
              ),
            ),
        ),
      ),
    )
    .groupBy(projectMember.organizationId, user.id);

  if (!due.length) return 0;
  await db.insert(notification).values(
    due.map((d) => ({
      id: newUuid(),
      projectId: d.projectId,
      userId: d.userId,
      kind: "agenda",
      entityType: "agenda",
      entityId: null,
      message: `You have ${d.tasks} new ${d.tasks === 1 ? "task" : "tasks"} today`,
      createdAt: now,
    })),
  );
  return due.length;
}
