import { Client as McpClient, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { VALID_KEY } from "./fake-ai.js";
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
afterEach(() => {
  expect(app.ai.reset(), "every scripted model step was played").toBe(0);
});

const memories = () => `/api/projects/${project.id}/memories`;

describe("user memory", () => {
  it("is private to its user and applies in every project", async () => {
    const created = await owner.post("/api/me/memories", { title: "Languages", content: "Fluent English and German" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: expect.stringMatching(/^umem_/), version: 1 });

    const other = await addMember(app, owner, project.id, "editor@example.test", "editor");
    expect((await other.get("/api/me/memories")).body.items).toEqual([]);
    const id = created.body.id;
    expect((await other.patch(`/api/me/memories/${id}`, { content: "x", version: 1 })).status).toBe(404);
    expect((await other.delete(`/api/me/memories/${id}?version=1`)).status).toBe(404);

    const list = await owner.get("/api/me/memories");
    expect(list.body.items).toEqual([expect.objectContaining({ id, title: "Languages" })]);
  });

  it("updates with optimistic concurrency and deletes for good", async () => {
    const { id } = (await owner.post("/api/me/memories", { title: "Remote", content: "Remote only" })).body;
    const updated = await owner.patch(`/api/me/memories/${id}`, { content: "Remote or hybrid in Berlin", version: 1 });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ title: "Remote", content: "Remote or hybrid in Berlin", version: 2 });

    const stale = await owner.patch(`/api/me/memories/${id}`, { content: "Office", version: 1 });
    expect(stale.status).toBe(412);
    expect((await owner.patch(`/api/me/memories/${id}`, { content: "Office" })).status).toBe(428);

    expect((await owner.delete(`/api/me/memories/${id}?version=1`)).status).toBe(412);
    expect((await owner.delete(`/api/me/memories/${id}?version=2`)).status).toBe(204);
    const items = (await owner.get("/api/me/memories")).body.items;
    expect(items.map((m: { id: string }) => m.id)).not.toContain(id);
  });
});

describe("project memory", () => {
  it("is shared with members and written by editors", async () => {
    const editor = await addMember(app, owner, project.id, "editor2@example.test", "editor");
    const viewer = await addMember(app, owner, project.id, "viewer@example.test", "viewer");

    const created = await editor.post(memories(), { title: "Goal", content: "Staff engineer role by March" });
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(/^pmem_/);
    expect((await viewer.post(memories(), { title: "Nope", content: "x" })).status).toBe(403);

    const seen = await viewer.get(memories());
    expect(seen.body.items).toEqual([
      expect.objectContaining({ title: "Goal", content: "Staff engineer role by March" }),
    ]);

    const id = created.body.id;
    expect((await viewer.patch(`${memories()}/${id}`, { content: "x", version: 1 })).status).toBe(403);
    const updated = await owner.patch(`${memories()}/${id}`, { content: "Staff engineer role by April", version: 1 });
    expect(updated.body.version).toBe(2);

    const audit = await owner.get(`/api/projects/${project.id}/audit?entityId=${id}`);
    expect(audit.body.items.map((e: { op: string }) => e.op)).toEqual(["update", "create"]);

    expect((await owner.delete(`${memories()}/${id}?version=2`)).status).toBe(204);
    expect((await viewer.get(memories())).body.items).toEqual([]);
  });

  it("rejects empty and oversized memories", async () => {
    expect((await owner.post(memories(), { title: " ", content: "x" })).status).toBe(422);
    expect((await owner.post(memories(), { title: "Big", content: "x".repeat(10_001) })).status).toBe(422);
  });
});

describe("agents", () => {
  it("gives the assistant both memories and lets it save new ones", async () => {
    await owner.request("PUT", "/api/me/ai/providers/anthropic", { apiKey: VALID_KEY });
    await owner.post("/api/me/memories", { title: "Writing style", content: "Short, no buzzwords" });
    await owner.post(memories(), { title: "Visa", content: "Needs relocation support to the Netherlands" });
    const chat = (
      await owner.post(`/api/projects/${project.id}/chats`, { model: "anthropic:test-model", approvalMode: "all" })
    ).body;

    app.ai.script(
      { toolCalls: [{ name: "createUserMemory", input: { title: "Notice period", content: "Three months" } }] },
      { text: "Saved." },
    );
    const res = await app.api.request(`/api/projects/${project.id}/chats/${chat.id}/messages`, {
      method: "POST",
      headers: { origin: PUBLIC_URL, "content-type": "application/json", ...owner.headers },
      body: JSON.stringify({
        message: { id: "m1", role: "user", parts: [{ type: "text", text: "My notice period is three months" }] },
      }),
    });
    expect(res.status).toBe(200);
    await res.text();

    const prompt = JSON.stringify(app.ai.prompts.at(-2));
    expect(prompt).toContain("Short, no buzzwords");
    expect(prompt).toContain("Needs relocation support to the Netherlands");
    const titles = (await owner.get("/api/me/memories")).body.items.map((m: { title: string }) => m.title);
    expect(titles).toContain("Notice period");
  });

  it("gives MCP clients the memories in the server instructions and as tools", async () => {
    const key = (await owner.post("/api/auth/api-key/create", { name: "memory test" })).body.key as string;
    const client = new McpClient({ name: "test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(project.mcpUrl), {
      requestInit: { headers: { "x-api-key": key } },
      fetch: async (input, init) => app.api.request(String(input).replace(PUBLIC_URL, ""), init as RequestInit),
    });
    await client.connect(transport);

    expect(client.getInstructions()).toContain("Needs relocation support to the Netherlands");
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "listUserMemories",
        "createUserMemory",
        "updateUserMemory",
        "deleteUserMemory",
        "listProjectMemories",
        "createProjectMemory",
        "updateProjectMemory",
        "deleteProjectMemory",
      ]),
    );
    const result = await client.callTool({ name: "listUserMemories", arguments: {} });
    expect(JSON.stringify(result.content)).toContain("Notice period");
  });
});
