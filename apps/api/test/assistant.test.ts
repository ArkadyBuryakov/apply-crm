import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { VALID_KEY } from "./fake-ai.js";
import { addMember, type Client, createTestApp, ownerWithProject, PUBLIC_URL, type TestApp } from "./helpers.js";

let app: TestApp;
let owner: Client;
let projectId: string;

beforeAll(async () => {
  app = await createTestApp();
  const created = await ownerWithProject(app);
  owner = created.owner;
  projectId = created.project.id;
  const saved = await owner.request("PUT", "/api/me/ai/providers/anthropic", { apiKey: VALID_KEY });
  expect(saved.status).toBe(200);
});
afterAll(async () => {
  await app.close();
});
afterEach(() => {
  expect(app.ai.reset(), "every scripted model step was played").toBe(0);
});

const chats = () => `/api/projects/${projectId}/chats`;

async function newChat(client: Client, body: Record<string, unknown> = {}) {
  const res = await client.post(chats(), { model: "anthropic:test-model", ...body });
  expect(res.status).toBe(201);
  return res.body as { id: string; title: string };
}

type Chunk = { type: string; [key: string]: unknown };

/** Sends one message and returns the parsed UI message stream chunks. */
async function send(client: Client, chatId: string, message: unknown, extra: Record<string, unknown> = {}) {
  const res = await app.api.request(`${chats()}/${chatId}/messages`, {
    method: "POST",
    headers: { origin: PUBLIC_URL, "content-type": "application/json", ...client.headers },
    body: JSON.stringify({ message, ...extra }),
  });
  const text = await res.text();
  if (res.status !== 200) return { status: res.status, chunks: [] as Chunk[], body: JSON.parse(text) };
  const chunks = text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Chunk);
  return { status: res.status, chunks, body: null };
}

const userMessage = (id: string, text: string, extraParts: unknown[] = []) => ({
  id,
  role: "user",
  parts: [...extraParts, { type: "text", text }],
});

async function storedMessages(chatId: string) {
  const res = await owner.get(`${chats()}/${chatId}`);
  expect(res.status).toBe(200);
  // biome-ignore lint/suspicious/noExplicitAny: test convenience
  return res.body.messages as any[];
}

describe("provider keys", () => {
  it("checks keys with the provider and never returns them", async () => {
    const rejected = await owner.request("PUT", "/api/me/ai/providers/openai", { apiKey: "fake-provider-key-bad" });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.message).toContain("rejected");

    const list = await owner.get("/api/me/ai/providers");
    expect(list.body.items).toEqual([
      expect.objectContaining({ provider: "anthropic", configured: true, last4: "y-ok" }),
      expect.objectContaining({ provider: "openai", configured: false, last4: null }),
      expect.objectContaining({ provider: "google", configured: false }),
    ]);
    expect(JSON.stringify(list.body)).not.toContain(VALID_KEY);

    const models = await owner.get("/api/me/ai/models");
    expect(models.body.items).toEqual([expect.objectContaining({ id: "anthropic:test-model" })]);
  });

  it("asks for a key before chatting with a provider that has none", async () => {
    const chat = await newChat(owner, { model: "google:test-model" });
    const res = await send(owner, chat.id, userMessage("m1", "Hi"));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("Google API key");
  });
});

describe("chats", () => {
  it("streams a reply, stores the history and titles the chat", async () => {
    const chat = await newChat(owner);
    app.ai.script({ text: "Hello there" });
    const res = await send(owner, chat.id, userMessage("m1", "What can you do for my job search?"), {
      page: `/p/${projectId}/agenda`,
    });
    expect(res.status).toBe(200);
    expect(res.chunks).toContainEqual(expect.objectContaining({ type: "text-delta", delta: "Hello there" }));

    const prompt = JSON.stringify(app.ai.prompts.at(-1));
    expect(prompt).toContain("Job search"); // project name in the instructions
    expect(prompt).toContain(`/p/${projectId}/agenda`);

    const messages = await storedMessages(chat.id);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const list = await owner.get(chats());
    expect(list.body.items[0]).toMatchObject({ id: chat.id, title: "What can you do for my job search?" });
  });

  it("keeps chats private to their author", async () => {
    const chat = await newChat(owner);
    const editor = await addMember(app, owner, projectId, "editor@example.test", "editor");
    expect((await editor.get(`${chats()}/${chat.id}`)).status).toBe(404);
    expect((await editor.get(chats())).body.items).toEqual([]);
    expect((await editor.delete(`${chats()}/${chat.id}`)).status).toBe(404);
  });

  it("runs reads automatically and waits for approval on writes in read mode", async () => {
    const chat = await newChat(owner, { approvalMode: "read" });
    app.ai.script(
      { toolCalls: [{ name: "listOrganizations", input: {} }] },
      { toolCalls: [{ name: "createOrganization", input: { kind: "company", name: "Initech" } }] },
    );
    const first = await send(owner, chat.id, userMessage("m1", "Add Initech"));
    expect(first.chunks).toContainEqual(expect.objectContaining({ type: "tool-output-available" }));
    const request = first.chunks.find((c) => c.type === "tool-approval-request");
    expect(request).toBeTruthy();
    expect((await owner.get(`/api/projects/${projectId}/organizations?q=Initech`)).body.items).toEqual([]);

    // The SPA answers the approval by resubmitting the latest assistant message.
    const messages = await storedMessages(chat.id);
    const assistant = messages.at(-1);
    for (const part of assistant.parts) {
      if (part.state === "approval-requested") {
        part.state = "approval-responded";
        part.approval = { ...part.approval, approved: true };
      }
    }
    app.ai.script({ text: "Added Initech." });
    const second = await send(owner, chat.id, assistant);
    expect(second.status).toBe(200);

    const orgs = await owner.get(`/api/projects/${projectId}/organizations?q=Initech`);
    expect(orgs.body.items).toHaveLength(1);
    const audit = await owner.get(`/api/projects/${projectId}/audit?entityId=${orgs.body.items[0].id}`);
    expect(audit.body.items[0].via).toBe("chat");
  });

  it("only offers tools the member's role allows", async () => {
    const viewer = await addMember(app, owner, projectId, "viewer@example.test", "viewer");
    await viewer.request("PUT", "/api/me/ai/providers/anthropic", { apiKey: VALID_KEY });
    const chat = await newChat(viewer, { approvalMode: "all" });
    app.ai.script({ toolCalls: [{ name: "createOrganization", input: { kind: "company", name: "Viewer Co" } }] });
    const res = await send(viewer, chat.id, userMessage("m1", "Add Viewer Co"));
    expect(res.status).toBe(200);
    expect(res.chunks.some((c) => c.type === "tool-output-available")).toBe(false);
    expect((await owner.get(`/api/projects/${projectId}/organizations?q=Viewer`)).body.items).toEqual([]);
  });

  it("leaves navigation to the browser", async () => {
    const chat = await newChat(owner);
    const navigation = {
      description: "Open a page",
      inputSchema: { type: "object", properties: { to: { type: "string" } }, required: ["to"] },
    };
    app.ai.script({ toolCalls: [{ name: "navigate", input: { to: "/p/$projectId/agenda" } }] });
    const res = await send(owner, chat.id, userMessage("m1", "Show my agenda"), { navigation });
    expect(res.chunks).toContainEqual(expect.objectContaining({ type: "tool-input-available", toolName: "navigate" }));
    expect(res.chunks.some((c) => c.type === "tool-output-available")).toBe(false);

    const assistant = (await storedMessages(chat.id)).at(-1);
    const call = assistant.parts.find((p: { type: string }) => p.type === "tool-navigate");
    Object.assign(call, { state: "output-available", output: { ok: true } });
    app.ai.script({ text: "Here is your agenda." });
    const done = await send(owner, chat.id, assistant, { navigation });
    expect(done.chunks).toContainEqual(expect.objectContaining({ type: "text-delta", delta: "Here is your agenda." }));
  });

  it("passes attachments to the model and rejects files models cannot read", async () => {
    const chat = await newChat(owner);
    const upload = await owner.upload(`${chats()}/${chat.id}/attachments`, "file", [
      { name: "notes.md", content: "# Interview prep\nAsk about on-call.", type: "" },
    ]);
    expect(upload.status).toBe(201);
    expect(upload.body.mediaType).toBe("text/plain");

    const binary = await owner.upload(`${chats()}/${chat.id}/attachments`, "file", [
      { name: "setup.exe", content: new Uint8Array([1, 2, 3]), type: "application/octet-stream" },
    ]);
    expect(binary.status).toBe(400);

    app.ai.script({ text: "Noted." });
    const file = { type: "file", mediaType: "text/plain", filename: "notes.md", url: upload.body.url };
    const res = await send(owner, chat.id, userMessage("m1", "Summarize", [file]));
    expect(res.status).toBe(200);
    expect(JSON.stringify(app.ai.prompts.at(-1))).toContain("Ask about on-call.");

    // Another chat cannot reference this chat's upload.
    const other = await newChat(owner);
    const stolen = await send(owner, other.id, userMessage("m1", "Summarize", [file]));
    expect(stolen.status).toBe(400);

    const download = await owner.raw(upload.body.url);
    expect(await download.text()).toContain("Interview prep");
    expect((await owner.delete(`${chats()}/${chat.id}`)).status).toBe(204);
    expect((await owner.raw(upload.body.url)).status).toBe(404);
  });

  it("retries the latest user message but rejects rewriting older history", async () => {
    const chat = await newChat(owner);
    app.ai.script({ text: "One" }, { text: "Two" }, { text: "Two again" });
    await send(owner, chat.id, userMessage("m1", "First"));
    await send(owner, chat.id, userMessage("m2", "Second"));
    expect((await send(owner, chat.id, userMessage("m1", "Edited first"))).status).toBe(400);

    const retry = await send(owner, chat.id, userMessage("m2", "Second"));
    expect(retry.status).toBe(200);
    const messages = await storedMessages(chat.id);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(JSON.stringify(messages.at(-1))).toContain("Two again");
  });
});
