import { createHash, randomBytes } from "node:crypto";
import { Client as McpClient, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, type Client, createTestApp, ownerWithProject, PUBLIC_URL, type TestApp } from "./helpers.js";

let app: TestApp;
let owner: Client;
let project: { id: string; mcpUrl: string };

beforeAll(async () => {
  app = await createTestApp();
  const created = await ownerWithProject(app);
  owner = created.owner;
  project = created.project;
});
afterAll(async () => {
  await app.close();
});

async function apiKeyFor(client: Client) {
  const res = await client.post("/api/auth/api-key/create", { name: "mcp test" });
  expect(res.status).toBe(200);
  expect(res.body.key).toMatch(/^crm_/);
  return res.body.key as string;
}

/** An MCP client whose HTTP requests go straight into the in-process app. */
async function connect(headers: Record<string, string>, url = project.mcpUrl) {
  const client = new McpClient({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
    fetch: async (input, init) => app.api.request(String(input).replace(PUBLIC_URL, ""), init as RequestInit),
  });
  await client.connect(transport);
  return client;
}

function parse(result: { content: unknown[] }) {
  const first = result.content[0] as { type: string; text: string };
  try {
    return JSON.parse(first.text);
  } catch {
    throw new Error(`Tool returned non-JSON: ${first.text}`);
  }
}

describe("MCP server", () => {
  it("challenges unauthenticated requests with protected resource metadata", async () => {
    const res = await app.api.request(new URL(project.mcpUrl).pathname, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    const header = res.headers.get("www-authenticate") ?? "";
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(header)?.[1];
    expect(metadataUrl).toBeTruthy();
    // biome-ignore lint/suspicious/noExplicitAny: test convenience
    const metadata: any = await (await app.api.request(new URL(metadataUrl!).pathname)).json();
    expect(metadata.resource).toBe(project.mcpUrl);
    expect(metadata.authorization_servers).toHaveLength(1);

    const asMetadata = await app.api.request("/.well-known/oauth-authorization-server/api/auth");
    expect(asMetadata.status).toBe(200);
    // biome-ignore lint/suspicious/noExplicitAny: test convenience
    const as: any = await asMetadata.json();
    expect(as.issuer).toBe(metadata.authorization_servers[0]);
    expect(as.registration_endpoint).toBeTruthy();
  });

  it("exposes role-filtered tools generated from the OpenAPI document", async () => {
    const ownerTools = (await (await connect({ "x-api-key": await apiKeyFor(owner) })).listTools()).tools;
    const names = ownerTools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "createOrganization",
        "getPositionOverview",
        "logInteraction",
        "linkActions",
        "getAgenda",
        "search",
        "createLatexVersion",
        "listMembers",
      ]),
    );
    // Not exposed: destructive or administrative operations.
    expect(names).not.toContain("deleteOrganization");
    expect(names).not.toContain("purgeContact");
    expect(names).not.toContain("transferOwnership");
    // Soft deletes of actions are reversible, so they are exposed.
    expect(names).toEqual(expect.arrayContaining(["deleteAction", "restoreAction"]));

    const create = ownerTools.find((t) => t.name === "createOrganization")!;
    expect(create.description).toContain("company");
    expect(create.inputSchema.properties).toHaveProperty("kind");
    expect(create.inputSchema.properties).not.toHaveProperty("projectId");
    expect(ownerTools.find((t) => t.name === "listOrganizations")!.annotations?.readOnlyHint).toBe(true);

    const viewer = await addMember(app, owner, project.id, "viewer@example.test", "viewer");
    const viewerNames = (await (await connect({ "x-api-key": await apiKeyFor(viewer) })).listTools()).tools.map(
      (t) => t.name,
    );
    expect(viewerNames).toContain("getPositionOverview");
    expect(viewerNames).not.toContain("createOrganization");
    expect(viewerNames).not.toContain("createComment");

    const coach = await addMember(app, owner, project.id, "coach@example.test", "commenter");
    const coachNames = (await (await connect({ "x-api-key": await apiKeyFor(coach) })).listTools()).tools.map(
      (t) => t.name,
    );
    expect(coachNames).toContain("createComment");
    expect(coachNames).not.toContain("logInteraction");
  });

  it("runs tool calls through the API as the caller", async () => {
    const mcp = await connect({ authorization: `Bearer ${await apiKeyFor(owner)}` });
    const created = await mcp.callTool({
      name: "createOrganization",
      arguments: { kind: "company", name: "Vandelay" },
    });
    expect(created.isError).toBeFalsy();
    const org = parse(created);
    expect(org.id).toMatch(/^org_/);

    const pos = parse(
      await mcp.callTool({ name: "createPosition", arguments: { title: "Importer/exporter", companyId: org.id } }),
    );
    const logged = await mcp.callTool({
      name: "logInteraction",
      arguments: {
        action: {
          type: "application",
          title: "Applied via email",
          status: "done",
          payload: { method: "email" },
          subjects: [{ positionId: pos.id }],
        },
      },
    });
    expect(logged.isError).toBeFalsy();
    expect(parse(logged).suggestions[0].stageKey).toBe("applied");

    const overview = parse(await mcp.callTool({ name: "getPositionOverview", arguments: { positionId: pos.id } }));
    expect(overview.timeline).toHaveLength(1);

    const stale = await mcp.callTool({
      name: "updatePosition",
      arguments: { positionId: pos.id, notes: "x", version: 99 },
    });
    expect(stale.isError).toBe(true);
    expect(parse(stale).error.code).toBe("precondition_failed");

    // Changes made through MCP are attributed as such in the audit log.
    const audit = await owner.get(`/api/projects/${project.id}/audit?entityId=${org.id}`);
    expect(audit.body.items[0].via).toBe("mcp");
  });

  it("rejects users who are not project members", async () => {
    const admin = owner;
    const other = await (async () => {
      await admin.post("/api/admin/invitations", { email: "stranger@example.test" });
      const { signUp } = await import("./helpers.js");
      return signUp(app, "stranger@example.test");
    })();
    const res = await app.api.request(new URL(project.mcpUrl).pathname, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-api-key": await apiKeyFor(other),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(403);
  });

  it("accepts OAuth access tokens bound to the project's resource", async () => {
    const token = await oauthAccessToken(owner, project.mcpUrl);
    const tools = (await (await connect({ authorization: `Bearer ${token}` })).listTools()).tools;
    expect(tools.map((t) => t.name)).toContain("getAgenda");

    // A token issued for one project's MCP resource is not accepted by another project's endpoint.
    const other = (await owner.post("/api/projects", { name: "Second" })).body;
    const res = await app.api.request(new URL(other.mcpUrl).pathname, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });
});

/** Runs the authorization-code flow an MCP client performs: registration, authorize, consent, token exchange. */
async function oauthAccessToken(user: Client, resource: string) {
  const redirectUri = "https://client.example/callback";
  const registered = await app.api.request("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Test MCP client",
    }),
  });
  expect(registered.status).toBe(201);
  const { client_id } = (await registered.json()) as { client_id: string };

  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    state: "state-1",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource,
  });
  const authorize = await app.api.request(`/api/auth/oauth2/authorize?${query}`, { headers: user.headers });
  expect(authorize.status).toBe(302);
  const consentUrl = new URL(authorize.headers.get("location")!, PUBLIC_URL);
  expect(consentUrl.pathname).toBe("/oauth/consent");

  const consent = await user.post("/api/auth/oauth2/consent", {
    accept: true,
    oauth_query: consentUrl.search.slice(1),
  });
  expect(consent.status).toBe(200);
  const code = new URL(consent.body.url).searchParams.get("code")!;

  const token = await app.api.request("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id,
      code_verifier: verifier,
      resource,
    }).toString(),
  });
  expect(token.status).toBe(200);
  return ((await token.json()) as { access_token: string }).access_token;
}
