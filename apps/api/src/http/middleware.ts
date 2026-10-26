import { projectMember } from "@crm/db";
import { fromPublicId, isProjectRole } from "@crm/shared";
import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { API_KEY_PREFIX } from "../auth.js";
import { ApiError, notFound } from "./errors.js";
import type { Actor, AppEnv } from "./types.js";

/** Resolves the caller from the MCP bridge, a session cookie or an API key. Unauthenticated requests get `null`. */
export const resolveActor = createMiddleware<AppEnv>(async (c, next) => {
  const internal = c.env?.internalActor;
  if (internal) {
    c.set("actor", internal);
    return next();
  }

  const headers = new Headers(c.req.raw.headers);
  const authorization = headers.get("authorization");
  if (authorization?.startsWith(`Bearer ${API_KEY_PREFIX}`)) {
    headers.set("x-api-key", authorization.slice("Bearer ".length));
    headers.delete("authorization");
  }
  const viaApiKey = headers.has("x-api-key");

  const { auth } = c.get("deps");
  const session = await auth.api.getSession({ headers }).catch(() => null);
  if (!session) {
    if (viaApiKey) throw new ApiError(401, "Invalid API key");
    c.set("actor", null);
    return next();
  }
  const user = session.user as typeof session.user & { isInstanceAdmin?: boolean; timezone?: string };
  const actor: Actor = {
    userId: user.id,
    email: user.email,
    name: user.name,
    isInstanceAdmin: Boolean(user.isInstanceAdmin),
    timezone: user.timezone ?? "UTC",
    via: viaApiKey ? "api_key" : "web",
  };
  c.set("actor", actor);
  return next();
});

/**
 * Mounted on /api/projects/:projectId/*. Loads the caller's membership; projects the caller is not a member of are
 * reported as not found so their existence is not revealed.
 */
export const projectScope = createMiddleware<AppEnv>(async (c, next) => {
  const actor = c.get("actor");
  if (!actor) throw new ApiError(401, "Sign in or provide an API key");
  const raw = c.req.param("projectId");
  const projectId = raw ? fromPublicId("project", raw) : null;
  if (!projectId) throw notFound("Project");

  const { db } = c.get("deps");
  const [membership] = await db
    .select({ role: projectMember.role })
    .from(projectMember)
    .where(and(eq(projectMember.organizationId, projectId), eq(projectMember.userId, actor.userId)))
    .limit(1);
  if (!membership || !isProjectRole(membership.role)) throw notFound("Project");

  c.set("project", { id: projectId, role: membership.role });
  return next();
});
