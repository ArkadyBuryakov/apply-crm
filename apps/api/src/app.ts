import type { Db } from "@crm/db";
import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { Auth } from "./auth.js";
import type { Env } from "./env.js";
import { ApiError, errorBody } from "./http/errors.js";
import { projectScope, resolveActor } from "./http/middleware.js";
import type { AppEnv, Deps } from "./http/types.js";
import { registerMcp } from "./mcp/server.js";
import { registerApiRoutes } from "./routes/index.js";
import type { Services } from "./services/index.js";

// BetterAuth endpoints that are not reachable over HTTP: projects and memberships change only through our API.
const BLOCKED_AUTH_PATHS = [/^\/api\/auth\/organization\//, /^\/api\/auth\/admin\//];

export function createApi(deps: { db: Db; auth: Auth; env: Env; services: Services }) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(errorBody(422, "Request validation failed", result.error.issues), 422);
      }
    },
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(errorBody(err.status, err.message, err.details), err.status);
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: { code: "internal_error", message: "Internal server error" } }, 500);
  });

  app.use("*", async (c, next) => {
    c.set("deps", deps as Deps);
    await next();
  });

  app.on(["GET", "POST"], ["/api/auth/*"], async (c) => {
    if (BLOCKED_AUTH_PATHS.some((re) => re.test(c.req.path))) {
      return c.json(errorBody(404, "Not found"), 404);
    }
    return await deps.auth.handler(c.req.raw);
  });

  app.use("/api/*", resolveActor);
  app.use("/api/projects/:projectId/*", projectScope);
  app.use("/api/projects/:projectId", async (c, next) => (c.req.method === "POST" ? next() : projectScope(c, next)));

  registerApiRoutes(app);

  app.openAPIRegistry.registerComponent("securitySchemes", "session", {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "apiKey", {
    type: "http",
    scheme: "bearer",
    description: "Personal API key (crm_…), also accepted in the x-api-key header",
  });

  app.doc31("/api/openapi.json", openApiInfo(deps.env.PUBLIC_URL));
  registerMcp(app, deps as Deps, () => app.getOpenAPI31Document(openApiInfo(deps.env.PUBLIC_URL)) as never);

  return app;
}

export function openApiInfo(publicUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Apply CRM API",
      version: "1.0.0",
      description:
        "Job-search CRM: organizations, positions, contacts and a graph of actions. Every operation lists the " +
        "permissions it needs in `x-permissions`; operations marked with `x-mcp` are also MCP tools.",
      license: { name: "AGPL-3.0-only", identifier: "AGPL-3.0-only" },
    },
    servers: [{ url: publicUrl }],
  };
}

export type Api = ReturnType<typeof createApi>;
