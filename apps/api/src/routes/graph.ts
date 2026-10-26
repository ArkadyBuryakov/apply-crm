// Action graph routes (ADR 0005).

import { action } from "@crm/db";
import { EDGE_KINDS } from "@crm/shared";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, inArray, type SQL } from "drizzle-orm";
import { errorResponses, notFound } from "../http/errors.js";
import {
  defineRoute,
  jsonBody,
  jsonResponse,
  NoContent,
  ProjectParams,
  pathId,
  publicId,
  Timestamp,
  uuidOf,
  withProject,
} from "../http/route.js";
import { scopeOf } from "../http/scope.js";
import type { AppEnv } from "../http/types.js";
import { loadActions } from "../services/actions.js";
import { visible } from "../services/core.js";
import { addEdge, edgesAmong, MAX_DEPTH, removeEdge, truncatedAt, walk } from "../services/graph.js";
import { ActionSchema, aboutOrganization, aboutPosition } from "./actions.js";

export const EdgeKindSchema = z.enum(EDGE_KINDS).openapi("EdgeKind", {
  description:
    "Edges point parent → child. follow_up: child follows up on parent; subtask: child is part of parent; " +
    "blocks: parent must finish before child can proceed; rescheduled: child replaces the rescheduled parent; " +
    "related: loose link.",
});

export const EdgeSchema = z
  .object({
    parentId: publicId("action"),
    childId: publicId("action"),
    kind: EdgeKindSchema,
    note: z.string().nullable(),
    createdAt: Timestamp,
  })
  .openapi("Edge");

const GraphSchema = z
  .object({
    nodes: z.array(ActionSchema),
    edges: z.array(EdgeSchema),
    truncated: z.boolean().openapi({ description: "More actions exist beyond the limit" }),
  })
  .openapi("ActionGraph");

const ActionParams = withProject({ actionId: pathId("action", "actionId") });

const addEdgeRoute = defineRoute({
  method: "post",
  path: "/api/projects/{projectId}/actions/{actionId}/edges",
  operationId: "linkActions",
  summary: "Link two actions",
  description:
    "Adds an edge from this action (the parent) to `childId`, e.g. an intro call → the application it led to " +
    "(`follow_up`). Edges may cross positions and organizations. Creating a cycle is allowed but returns " +
    '`warnings: ["cycle"]`.',
  scope: "project",
  permissions: ["edge:create"],
  mcp: { expose: true },
  tags: ["Graph"],
  request: {
    params: ActionParams,
    body: jsonBody(
      z.object({ childId: publicId("action"), kind: EdgeKindSchema, note: z.string().max(2000).nullable().optional() }),
    ),
  },
  responses: {
    201: jsonResponse(z.object({ edge: EdgeSchema, warnings: z.array(z.literal("cycle")) }), "Linked"),
    ...errorResponses(400, 403, 404, 409),
  },
});

const removeEdgeRoute = defineRoute({
  method: "delete",
  path: "/api/projects/{projectId}/actions/{actionId}/edges/{childId}",
  operationId: "unlinkActions",
  summary: "Remove a link between two actions",
  description: "Deletes the edge of the given kind from this action to `childId`.",
  scope: "project",
  permissions: ["edge:delete"],
  mcp: { expose: true },
  tags: ["Graph"],
  request: {
    params: withProject({ actionId: pathId("action", "actionId"), childId: pathId("action", "childId") }),
    query: z.object({ kind: EdgeKindSchema }),
  },
  responses: { 204: NoContent, ...errorResponses(403, 404) },
});

const actionGraphRoute = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/actions/{actionId}/graph",
  operationId: "getActionGraph",
  summary: "Get the actions linked to an action",
  description:
    "Walks the graph from this action: `descendants` (what it led to), `ancestors` (what led to it) or `both`, " +
    `up to \`maxDepth\` edges away (max ${MAX_DEPTH}). Safe on cyclic graphs.`,
  scope: "project",
  permissions: ["action:read", "edge:read"],
  mcp: { expose: true },
  tags: ["Graph"],
  request: {
    params: ActionParams,
    query: z.object({
      direction: z.enum(["descendants", "ancestors", "both"]).default("both"),
      maxDepth: z.coerce.number().int().min(1).max(MAX_DEPTH).default(5),
    }),
  },
  responses: { 200: jsonResponse(GraphSchema, "Subgraph"), ...errorResponses(404) },
});

const GRAPH_LIMIT = 500;

const projectGraphRoute = defineRoute({
  method: "get",
  path: "/api/projects/{projectId}/graph",
  operationId: "getProjectGraph",
  summary: "Get the action graph of a position, an organization or the project",
  description: `All actions about the position or organization (or the whole project, newest ${GRAPH_LIMIT}) with the edges between them.`,
  scope: "project",
  permissions: ["action:read", "edge:read"],
  tags: ["Graph"],
  request: {
    params: ProjectParams,
    query: z.object({
      positionId: publicId("position").optional(),
      organizationId: publicId("organization").optional(),
    }),
  },
  responses: { 200: jsonResponse(GraphSchema, "Graph"), ...errorResponses(404) },
});

export function registerGraphRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(addEdgeRoute, async (c) => {
    const s = scopeOf(c);
    const body = c.req.valid("json");
    const result = await s.db.transaction((tx) =>
      addEdge(tx, s, {
        parentId: uuidOf("action", c.req.valid("param").actionId),
        childId: uuidOf("action", body.childId),
        kind: body.kind,
        note: body.note,
      }),
    );
    return c.json({ edge: result.edge, warnings: result.warnings as "cycle"[] }, 201);
  });

  app.openapi(removeEdgeRoute, async (c) => {
    const s = scopeOf(c);
    const params = c.req.valid("param");
    await s.db.transaction((tx) =>
      removeEdge(tx, s, uuidOf("action", params.actionId), uuidOf("action", params.childId), c.req.valid("query").kind),
    );
    return c.body(null, 204);
  });

  app.openapi(actionGraphRoute, async (c) => {
    const s = scopeOf(c);
    const start = uuidOf("action", c.req.valid("param").actionId);
    const { direction, maxDepth } = c.req.valid("query");
    const [root] = await s.db
      .select({ id: action.id })
      .from(action)
      .where(visible(action, s, start));
    if (!root) throw notFound("Action");
    const nodes = await walk(s.db, start, direction, maxDepth);
    const ids = [...nodes.keys()];
    const rows = await s.db
      .select()
      .from(action)
      .where(and(visible(action, s), inArray(action.id, ids)));
    return c.json(
      {
        nodes: await loadActions(s.db, rows),
        edges: await edgesAmong(s.db, s, ids),
        truncated: await truncatedAt(s.db, nodes, maxDepth),
      },
      200,
    );
  });

  app.openapi(projectGraphRoute, async (c) => {
    const s = scopeOf(c);
    const q = c.req.valid("query");
    const conditions: SQL[] = [visible(action, s)];
    if (q.positionId) conditions.push(aboutPosition(uuidOf("position", q.positionId)));
    if (q.organizationId) conditions.push(aboutOrganization(uuidOf("organization", q.organizationId)));
    const rows = await s.db
      .select()
      .from(action)
      .where(and(...conditions))
      .orderBy(desc(action.id))
      .limit(GRAPH_LIMIT + 1);
    const truncated = rows.length > GRAPH_LIMIT;
    const nodes = rows.slice(0, GRAPH_LIMIT);
    return c.json(
      {
        nodes: await loadActions(s.db, nodes),
        edges: await edgesAmong(
          s.db,
          s,
          nodes.map((n) => n.id),
        ),
        truncated,
      },
      200,
    );
  });
}
