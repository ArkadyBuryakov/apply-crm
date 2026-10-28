// Hosted MCP endpoint per project (ADR 0010): /mcp/projects/{projectId}, Streamable HTTP, stateless.
// Callers authenticate with an OAuth access token issued for this project's resource URL, or with an API key.
// Tools are generated from the OpenAPI document and filtered by the caller's role; calls run through the REST API.
import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { projectMember, user } from "@crm/db";
import { fromPublicId, isProjectRole, type ProjectRole, roleHas } from "@crm/shared";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createMcpHandler, fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { createLocalJWKSet, jwtVerify } from "jose";
import { API_KEY_PREFIX } from "../auth.js";
import type { Actor, AppEnv, Deps } from "../http/types.js";
import { mcpUrlFor } from "../routes/projects.js";
import { buildToolCatalog, type OpenApiDocument, type ToolDefinition, toHttpRequest } from "./catalog.js";

const SERVER_INFO = { name: "apply-crm", version: "1.0.0" };

type McpCaller = { actor: Actor; role: ProjectRole };

/** Shared by the MCP server and the in-app assistant (ADR 0031). */
export const CRM_INSTRUCTIONS =
  "Job-search CRM for one project. Positions are job openings at companies (optionally via agencies); actions " +
  "are emails, meetings, interviews, applications, take-homes, offers, reference checks, rejections, tasks and " +
  "notes, linked into a graph. Search before creating organizations or contacts. Start work on a position with " +
  "getPositionOverview; record what happened with logInteraction. Read a document's contents (resumes, offer " +
  "letters, …) with readDocumentVersion. Updates need the entity's current `version`.";

/** The tool catalog, built once from the OpenAPI document on first use. */
export function lazyToolCatalog(getDocument: () => OpenApiDocument) {
  let catalog: ToolDefinition[] | undefined;
  return () => {
    catalog ??= buildToolCatalog(getDocument());
    return catalog;
  };
}

export function registerMcp(app: OpenAPIHono<AppEnv>, deps: Deps, tools: () => ToolDefinition[]) {
  // OAuth discovery at the root, where MCP clients look for it (RFC 8414 / RFC 9728).
  const authServerMetadata = oauthProviderAuthServerMetadata(deps.auth);
  const openIdMetadata = oauthProviderOpenIdConfigMetadata(deps.auth);
  app.get("/.well-known/oauth-authorization-server", (c) => authServerMetadata(c.req.raw));
  app.get("/.well-known/oauth-authorization-server/*", (c) => authServerMetadata(c.req.raw));
  app.get("/.well-known/openid-configuration", (c) => openIdMetadata(c.req.raw));
  app.get("/.well-known/openid-configuration/*", (c) => openIdMetadata(c.req.raw));
  app.get("/.well-known/oauth-protected-resource/mcp/projects/:projectId", async (c) =>
    c.json({
      resource: mcpUrlFor(deps.env.PUBLIC_URL, uuidFromParam(c) ?? ""),
      authorization_servers: [await issuer(deps)],
      bearer_methods_supported: ["header"],
      resource_name: "Apply CRM",
    }),
  );

  app.all("/mcp/projects/:projectId", async (c) => {
    const projectId = uuidFromParam(c);
    if (!projectId) return c.json({ error: "Unknown project" }, 404);
    const resource = mcpUrlFor(deps.env.PUBLIC_URL, projectId);
    const caller = await authenticate(c, deps, projectId, resource);
    if (caller instanceof Response) return caller;

    const projectPublicId = c.req.param("projectId")!;
    const allowed = tools().filter((t) => roleHas(caller.role, ...t.permissions));
    const handler = createMcpHandler(() => buildServer(app, allowed, caller.actor, projectPublicId), {
      legacy: "stateless",
    });
    try {
      return await handler.fetch(c.req.raw);
    } finally {
      await handler.close();
    }
  });
}

function uuidFromParam(c: Context) {
  const raw = c.req.param("projectId");
  return raw ? fromPublicId("project", raw) : null;
}

let cachedIssuer: string | undefined;
async function issuer(deps: Deps) {
  if (!cachedIssuer) {
    const config = (await deps.auth.api.getOAuthServerConfig()) as { issuer: string };
    cachedIssuer = config.issuer;
  }
  return cachedIssuer;
}

function challenge(deps: Deps, projectPublicId: string, error?: string) {
  const metadata = new URL(
    `/.well-known/oauth-protected-resource/mcp/projects/${projectPublicId}`,
    deps.env.PUBLIC_URL,
  );
  const parts = [`Bearer resource_metadata="${metadata}"`];
  if (error) parts.push(`error="${error}"`);
  return new Response(JSON.stringify({ error: error ?? "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": parts.join(", ") },
  });
}

async function authenticate(
  c: Context<AppEnv>,
  deps: Deps,
  projectId: string,
  resource: string,
): Promise<McpCaller | Response> {
  const projectPublicId = c.req.param("projectId")!;
  const authorization = c.req.header("authorization") ?? "";
  const apiKey =
    c.req.header("x-api-key") ?? (authorization.startsWith(`Bearer ${API_KEY_PREFIX}`) ? authorization.slice(7) : null);

  let userId: string | null = null;
  if (apiKey) {
    const session = await deps.auth.api.getSession({ headers: new Headers({ "x-api-key": apiKey }) }).catch(() => null);
    userId = session?.user.id ?? null;
  } else if (authorization.startsWith("Bearer ")) {
    userId = await verifyAccessToken(deps, authorization.slice(7), resource);
  }
  if (!userId) return challenge(deps, projectPublicId, authorization || apiKey ? "invalid_token" : undefined);

  const [row] = await deps.db
    .select({
      role: projectMember.role,
      email: user.email,
      name: user.name,
      isInstanceAdmin: user.isInstanceAdmin,
      timezone: user.timezone,
    })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .where(and(eq(projectMember.organizationId, projectId), eq(projectMember.userId, userId)));
  if (!row || !isProjectRole(row.role)) {
    return new Response(JSON.stringify({ error: "forbidden", message: "You are not a member of this project" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return {
    role: row.role,
    actor: {
      userId,
      email: row.email,
      name: row.name,
      isInstanceAdmin: row.isInstanceAdmin,
      timezone: row.timezone,
      via: "mcp",
    },
  };
}

/** Verifies a JWT access token against our own JWKS, issuer and this project's resource (audience). */
async function verifyAccessToken(deps: Deps, token: string, resource: string): Promise<string | null> {
  try {
    const jwks = (await deps.auth.api.getJwks()) as Parameters<typeof createLocalJWKSet>[0];
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer: await issuer(deps),
      audience: resource,
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function buildServer(app: OpenAPIHono<AppEnv>, tools: ToolDefinition[], actor: Actor, projectPublicId: string) {
  const server = new McpServer(SERVER_INFO, { instructions: CRM_INSTRUCTIONS });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as never),
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: tool.destructive,
          openWorldHint: false,
        },
      },
      async (args) => callTool(app, tool, actor, projectPublicId, (args ?? {}) as Record<string, unknown>),
    );
  }
  return server;
}

async function callTool(
  app: OpenAPIHono<AppEnv>,
  tool: ToolDefinition,
  actor: Actor,
  projectPublicId: string,
  args: Record<string, unknown>,
) {
  const result = await invokeTool(app, tool, actor, projectPublicId, args);
  if (result.status === 204) return { content: [{ type: "text" as const, text: "Done." }] };
  const { body } = result;
  return {
    ...(result.ok ? {} : { isError: true }),
    content: [{ type: "text" as const, text: typeof body === "string" ? body : JSON.stringify(body) }],
    ...(result.ok && body && typeof body === "object" && !Array.isArray(body)
      ? { structuredContent: body as Record<string, unknown> }
      : {}),
  };
}

/**
 * Runs a catalog tool as an in-process request to the API on behalf of `actor`, so validation, authorization and
 * audit are exactly those of the REST call. Bad arguments come back as a 400 result rather than an exception.
 */
export async function invokeTool(
  app: OpenAPIHono<AppEnv>,
  tool: ToolDefinition,
  actor: Actor,
  projectPublicId: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  let request: ReturnType<typeof toHttpRequest>;
  try {
    request = toHttpRequest(tool, projectPublicId, args);
  } catch (err) {
    return { ok: false, status: 400, body: String((err as Error).message) };
  }
  const res = await app.request(
    request.url,
    {
      method: request.method,
      headers: request.body === undefined ? {} : { "content-type": "application/json" },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    },
    { internalActor: actor },
  );
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  return { ok: res.status < 400, status: res.status, body };
}
