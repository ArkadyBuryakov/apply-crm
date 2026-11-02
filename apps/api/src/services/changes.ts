// Live updates (ADR 0034): every committed change becomes a Postgres NOTIFY, and each API replica forwards it to the
// SSE streams allowed to see it. Events only say that something changed; clients refetch through the normal API.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "@crm/db";
import { type IdKind, type Permission, toPublicId } from "@crm/shared";
import { sql } from "drizzle-orm";
import type { AuditOp } from "./core.js";

const CHANNEL = "crm_changes";

/** What a stream needs to be allowed to read to receive an event about the entity, and how its ID is made public. */
const ENTITIES = {
  action: { read: "action:read", idKind: "action" },
  affiliation: { read: "contact:read", idKind: "affiliation" },
  channel: { read: "channel:read", idKind: "channel" },
  comment: { read: "comment:read", idKind: "comment" },
  contact: { read: "contact:read", idKind: "contact" },
  document: { read: "document:read", idKind: "document" },
  documentVersion: { read: "document:read", idKind: "documentVersion" },
  edge: { read: "edge:read" },
  handle: { read: "contact:read", idKind: "handle" },
  invitation: { read: "membership:read", idKind: "invitation" },
  member: { read: "membership:read", idKind: "user" },
  memory: { read: "memory:read", idKind: "projectMemory" },
  notification: { read: "project:read" },
  organization: { read: "organization_entity:read", idKind: "organization" },
  position: { read: "position:read", idKind: "position" },
  project: { read: "project:read", idKind: "project" },
  stage: { read: "stage:read", idKind: "stage" },
  template: { read: "template:read", idKind: "template" },
  templateVersion: { read: "template:read", idKind: "templateVersion" },
  /** A change that did not say what it touched: the fallback for routes that write without an audit entry. */
  other: { read: "project:read" },
} as const satisfies Record<string, { read: Permission; idKind?: IdKind }>;

export type ChangeEntity = keyof typeof ENTITIES;

/** Internal IDs; a change belongs to a project or, like user memory, to one user. */
export type Change = { entityType: ChangeEntity; entityId: string | null; operationType: AuditOp } & (
  | { projectId: string }
  | { userId: string }
);

/** The same change with public IDs, as sent to clients. */
export type ChangeEvent = Change;

function toEvent(change: Change): ChangeEvent {
  const { idKind } = ENTITIES[change.entityType] as { idKind?: IdKind };
  const entityId = idKind && change.entityId ? toPublicId(idKind, change.entityId) : null;
  return "projectId" in change
    ? { ...change, entityId, projectId: toPublicId("project", change.projectId) }
    : { ...change, entityId, userId: toPublicId("user", change.userId) };
}

const collector = new AsyncLocalStorage<Change[]>();

/** Runs `fn` so that the changes it records end up in `changes`; the route guard publishes them after a success. */
export function collectChanges<T>(changes: Change[], fn: () => T): T {
  return collector.run(changes, fn);
}

export function recordChange(change: Change) {
  collector.getStore()?.push(change);
}

/** Announces committed changes. The data is already saved, so a failure here must not fail the caller. */
export async function publishChanges(db: Db, changes: Change[]): Promise<void> {
  try {
    for (const change of changes) {
      await db.execute(sql`select pg_notify(${CHANNEL}, ${JSON.stringify(toEvent(change))})`);
    }
  } catch (err) {
    console.error("[changes] publish failed", err);
  }
}

export type ChangeSubscriber = {
  projectId: string;
  userId: string;
  can: (permission: Permission) => boolean;
  send: (event: ChangeEvent) => void;
  close: () => void;
};

/** Forwards this replica's notifications to its open streams. Holds one extra connection once the first stream opens. */
export class ChangeHub {
  private readonly subscribers = new Set<ChangeSubscriber>();
  private listening: Promise<unknown> | null = null;

  constructor(private readonly db: Db) {}

  /** Resolves once notifications are being received. */
  ready() {
    if (!this.listening) {
      let connected = false;
      this.listening = this.db.$client
        .listen(
          CHANNEL,
          (payload) => this.dispatch(JSON.parse(payload)),
          () => {
            // Notifications sent while the connection was down are gone; reconnecting clients refetch everything.
            if (connected) for (const subscriber of [...this.subscribers]) subscriber.close();
            connected = true;
          },
        )
        .catch((err) => {
          this.listening = null;
          throw err;
        });
    }
    return this.listening;
  }

  subscribe(subscriber: ChangeSubscriber) {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  private dispatch(event: ChangeEvent) {
    for (const subscriber of [...this.subscribers]) {
      if ("userId" in event) {
        if (event.userId === subscriber.userId) subscriber.send(event);
      } else if (event.projectId === subscriber.projectId) {
        if (subscriber.can(ENTITIES[event.entityType].read)) subscriber.send(event);
        // Access is checked when a stream opens, so changes to who has which role send everyone back through the guard.
        if (event.entityType === "member" || event.entityType === "project") subscriber.close();
      }
    }
  }
}
