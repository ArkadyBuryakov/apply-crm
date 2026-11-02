// Live updates over SSE (ADR 0034).
import { type Permission, roleHas } from "@crm/shared";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { errorResponses } from "../http/errors.js";
import { defineRoute, ProjectParams } from "../http/route.js";
import { pid } from "../http/serialize.js";
import type { AppEnv } from "../http/types.js";

const PING_INTERVAL_MS = 25_000;

const streamProjectEvents = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/events",
  operationId: "streamProjectEvents",
  summary: "Stream changes to this project",
  description:
    "Server-sent events, one `{ projectId | userId, entityType, entityId, operationType }` per change. They carry no " +
    "data: refetch what you show. The server closes the stream every few minutes and on membership changes; reconnect " +
    "and refetch.",
  scope: "project",
  permissions: ["project:read"],
  tags: ["Events"],
  request: { params: ProjectParams },
  responses: {
    200: { description: "Event stream", content: { "text/event-stream": { schema: z.string() } } },
    ...errorResponses(404),
  },
});

export function registerEventRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(streamProjectEvents, async (c) => {
    const { changes, env } = c.var.deps;
    const { id, role } = c.var.project;
    const actor = c.var.actor!;
    await changes.ready();
    return streamSSE(
      c,
      (stream) =>
        new Promise<void>((resolve) => {
          const close = () => {
            clearInterval(ping);
            clearTimeout(maxAge);
            unsubscribe();
            resolve();
          };
          const unsubscribe = changes.subscribe({
            projectId: pid("project", id),
            userId: pid("user", actor.userId),
            can: (permission: Permission) => roleHas(role, permission),
            send: (event) => void stream.writeSSE({ data: JSON.stringify(event) }).catch(close),
            close,
          });
          const ping = setInterval(
            () => void stream.writeSSE({ event: "ping", data: "" }).catch(close),
            PING_INTERVAL_MS,
          );
          // Sessions expire and API keys get revoked; reconnecting sends the client back through the guard.
          const maxAge = setTimeout(close, env.CHANGE_STREAM_MAX_AGE_MS);
          stream.onAbort(close);
          void stream.writeSSE({ event: "ready", data: "" }).catch(close);
        }),
    ) as never;
  });
}
