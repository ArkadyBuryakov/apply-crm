// Route definition wrapper (ADR 0009). Every route declares who may call it; the same declaration is emitted into the
// OpenAPI document (`x-scope`, `x-permissions`, `x-mcp`) and enforced at runtime, so the two cannot drift apart.

import { fromPublicId, ID_PREFIXES, type IdKind, type Permission, publicIdPattern, roleHas } from "@crm/shared";
import { createRoute, type RouteConfig, z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { ApiError, badRequest } from "./errors.js";
import type { AppEnv } from "./types.js";

/** Who can reach a route at all; project routes additionally check `permissions` against the caller's role. */
export type RouteScope = "public" | "user" | "instance_admin" | "project";

export type McpConfig = {
  /** Only exposed operations become MCP tools (ADR 0010). */
  expose: boolean;
  /** Tool name, if it should differ from the operationId. */
  name?: string;
  /** Tool description, if the operation's summary + description is not written well enough for an LLM. */
  description?: string;
};

type RouteDefinition = RouteConfig & {
  operationId: string;
  summary: string;
  description: string;
  scope: RouteScope;
  permissions: readonly Permission[];
  mcp?: McpConfig;
};

export function defineRoute<const R extends RouteDefinition>(definition: R) {
  const { scope, permissions, mcp, ...config } = definition;
  if (scope === "project" && !config.path.startsWith("/api/projects/{projectId}")) {
    throw new Error(`${config.operationId}: project-scoped routes must live under /api/projects/{projectId}`);
  }
  if (scope !== "project" && permissions.length > 0) {
    throw new Error(`${config.operationId}: permissions only apply to project-scoped routes`);
  }
  return createRoute({
    ...config,
    "x-scope": scope,
    "x-permissions": permissions,
    ...(mcp ? { "x-mcp": mcp } : {}),
    ...(scope === "public" ? {} : { security: [{ session: [] }, { apiKey: [] }] }),
    middleware: [guard(scope, permissions)] as const,
  } as Omit<R, "scope" | "permissions" | "mcp">);
}

function guard(scope: RouteScope, permissions: readonly Permission[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (scope === "public") return next();
    const actor = c.get("actor");
    if (!actor) throw new ApiError(401, "Sign in or provide an API key");
    if (scope === "instance_admin" && !actor.isInstanceAdmin) throw new ApiError(403, "Instance admins only");
    if (scope === "project") {
      const project = c.get("project");
      if (!project) throw new Error("project scope middleware did not run");
      if (!roleHas(project.role, ...permissions)) {
        throw new ApiError(403, `Your role (${project.role}) lacks ${permissions.join(", ")}`);
      }
    }
    return next();
  });
}

// ---------------------------------------------------------------------------
// Schema helpers

export function publicId(kind: IdKind) {
  return z
    .string()
    .regex(publicIdPattern(kind))
    .openapi({ example: `${ID_PREFIXES[kind]}_01JBX3V6Q9W2G8K4M7N5P0R1S2`, description: `${kind} ID` });
}

export function pathId(kind: IdKind, name: string) {
  return publicId(kind).openapi({ param: { name, in: "path" } });
}

export const ProjectParams = z.object({ projectId: pathId("project", "projectId") });

export function withProject<T extends z.ZodRawShape>(shape: T) {
  return ProjectParams.extend(shape);
}

/** Decodes a validated public ID into its UUID. */
export function uuidOf(kind: IdKind, value: string): string {
  const uuid = fromPublicId(kind, value);
  if (!uuid) throw badRequest(`Invalid ${kind} ID: ${value}`);
  return uuid;
}

export function optionalUuidOf(kind: IdKind, value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  return uuidOf(kind, value);
}

export const Timestamp = z.iso.datetime({ offset: true }).openapi({ example: "2026-10-26T14:00:00.000Z" });

export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50).openapi({ description: "Page size" }),
  cursor: z.string().optional().openapi({ description: "nextCursor from the previous page" }),
});

export function page<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable().openapi({ description: "Pass as `cursor` to fetch the next page" }),
  });
}

export const VersionField = z
  .int()
  .min(1)
  .openapi({ description: "Current version of the entity (optimistic concurrency). Alternative to If-Match." });

export function jsonBody<T extends z.ZodType>(schema: T, description?: string) {
  return {
    required: true,
    ...(description ? { description } : {}),
    content: { "application/json": { schema } },
  } as const;
}

export function jsonResponse<T extends z.ZodType>(schema: T, description: string) {
  return { description, content: { "application/json": { schema } } } as const;
}

export const NoContent = { description: "Done" } as const;

/**
 * Reads the expected entity version from `If-Match` (`"3"` or `W/"3"`) or from an explicit `version` field (ADR 0012).
 */
export function expectedVersion(c: { req: { header(name: string): string | undefined } }, explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const header = c.req.header("if-match");
  if (header) {
    const match = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim());
    if (match) return Number(match[1]);
    throw badRequest('If-Match must be the entity version, e.g. "3"');
  }
  throw new ApiError(428, "Send the entity version in If-Match or in the `version` field");
}

export function etag(version: number) {
  return `"${version}"`;
}
