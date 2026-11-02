// Live updates (ADR 0034): what the event stream delivers, to whom, and when it closes.
import { Client as McpClient, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type ChangeEvent, ChangeHub } from "../src/services/changes.js";
import { runCompileJob } from "../src/services/compile.js";
import { runAgendaDigest } from "../src/services/digest.js";
import {
  addMember,
  anonymous,
  type Client,
  createTestApp,
  ownerWithProject,
  PUBLIC_URL,
  signUpInvited,
  type TestApp,
} from "./helpers.js";

let app: TestApp;
let owner: Client;
let viewer: Client;
let p: string;
const base = (projectId = p) => `/api/projects/${projectId}`;
const streams: { cancel: () => Promise<void> }[] = [];

beforeAll(async () => {
  app = await createTestApp();
  const created = await ownerWithProject(app);
  owner = created.owner;
  p = created.project.id;
  viewer = await addMember(app, owner, p, "viewer@example.test", "viewer");
});
afterAll(async () => {
  await Promise.all(streams.map((s) => s.cancel()));
  await app.close();
});

/** Opens a stream and collects what it delivers; resolves once the server has subscribed it. */
async function open(client: Client, projectId = p, testApp = app) {
  const res = await testApp.api.request(`${base(projectId)}/events`, { headers: client.headers });
  expect(res.status).toBe(200);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const stream = {
    // biome-ignore lint/suspicious/noExplicitAny: test convenience
    events: [] as any[],
    closed: false,
    cancel: () => reader.cancel().catch(() => {}),
  };
  streams.push(stream);
  let ready = () => {};
  const subscribed = new Promise<void>((resolve) => {
    ready = resolve;
  });
  void (async () => {
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const frames = buffer.split("\n\n");
      buffer = frames.pop()!;
      for (const frame of frames) {
        if (frame.startsWith("event: ready")) ready();
        else if (frame.startsWith("data: ")) stream.events.push(JSON.parse(frame.slice(6)));
      }
    }
    stream.closed = true;
  })();
  await subscribed;
  return stream;
}

const newOrg = (name: string, projectId = p, client = owner) =>
  client.post(`${base(projectId)}/organizations`, { kind: "company", name });

/** Waits for an event about an entity. Negative checks write a later sentinel, so a missing event is not just a slow one. */
async function delivered(stream: { events: { entityId: string }[] }, entityId: string) {
  await vi.waitFor(() => expect(stream.events.map((e) => e.entityId)).toContain(entityId));
}

describe("event stream access", () => {
  it("is refused to anyone who is not a member", async () => {
    expect((await anonymous(app).get(`${base()}/events`)).status).toBe(401);
    const stranger = await signUpInvited(app, owner, "stranger@example.test");
    expect((await stranger.get(`${base()}/events`)).status).toBe(404);
  });

  it("delivers a project's changes only to that project's streams", async () => {
    const otherOwner = await signUpInvited(app, owner, "other-owner@example.test");
    const otherProject = (await otherOwner.post("/api/projects", { name: "Other" })).body;
    const here = await open(viewer);
    const there = await open(otherOwner, otherProject.id);

    const org = await newOrg("Acme");
    await delivered(here, org.body.id);
    expect(here.events).toContainEqual({
      projectId: p,
      entityType: "organization",
      entityId: org.body.id,
      operationType: "create",
    });
    const sentinel = await newOrg("Elsewhere", otherProject.id, otherOwner);
    await delivered(there, sentinel.body.id);
    expect(there.events.map((e) => e.entityId)).not.toContain(org.body.id);
  });

  it("filters events by the stream's read permissions", async () => {
    const hub = new ChangeHub(app.db);
    await hub.ready();
    const received: ChangeEvent[] = [];
    hub.subscribe({
      projectId: p,
      userId: "usr_nobody",
      can: (permission) => permission !== "position:read",
      send: (event) => received.push(event),
      close: () => {},
    });
    const position = await owner.post(`${base()}/positions`, { title: "Hidden" });
    const org = await newOrg("Visible");
    await vi.waitFor(() => expect(received.map((e) => e.entityId)).toContain(org.body.id));
    expect(received.map((e) => e.entityId)).not.toContain(position.body.id);
  });

  it("sends everyone back through the guard when membership changes", async () => {
    const leaving = await addMember(app, owner, p, "leaving@example.test", "editor");
    const stream = await open(leaving);
    const members = (await owner.get(`${base()}/members`)).body.items;
    const userId = members.find((m: { email: string }) => m.email === "leaving@example.test").userId;

    expect((await owner.delete(`${base()}/members/${userId}`)).status).toBe(204);
    await vi.waitFor(() => expect(stream.closed).toBe(true));
    expect((await leaving.get(`${base()}/events`)).status).toBe(404);
  });

  it("closes streams after their maximum age", async () => {
    const shortLived = await createTestApp({ CHANGE_STREAM_MAX_AGE_MS: "100" });
    try {
      const created = await ownerWithProject(shortLived);
      const stream = await open(created.owner, created.project.id, shortLived);
      await vi.waitFor(() => expect(stream.closed).toBe(true));
    } finally {
      await shortLived.close();
    }
  });
});

describe("what announces a change", () => {
  it("reports every entity a composite write touched", async () => {
    const stream = await open(owner);
    const first = await owner.post(`${base()}/log-interaction`, {
      action: { type: "note", title: "First", payload: {} },
    });
    const second = await owner.post(`${base()}/log-interaction`, {
      action: { type: "note", title: "Second", payload: {} },
      previousActionId: first.body.action.id,
    });
    expect(second.status).toBe(201);
    await delivered(stream, second.body.action.id);
    await vi.waitFor(() => expect(stream.events.map((e) => e.entityType)).toContain("edge"));
  });

  it("announces nothing for a write that failed", async () => {
    const stream = await open(owner);
    const org = await newOrg("Versioned");
    await delivered(stream, org.body.id);
    stream.events.length = 0;

    const stale = await owner.patch(`${base()}/organizations/${org.body.id}`, { name: "Stale", version: 99 });
    expect(stale.status).toBe(412);
    const sentinel = await newOrg("After the failure");
    await delivered(stream, sentinel.body.id);
    expect(stream.events.map((e) => e.entityId)).not.toContain(org.body.id);
  });

  it("falls back to a generic event for a write without an audit entry", async () => {
    const stream = await open(owner);
    const org = await newOrg("Tracker");
    const invitation = await owner.post(`${base()}/invitations`, { email: "invited@example.test", role: "viewer" });
    expect(invitation.status).toBe(201);
    await delivered(stream, org.body.id);
    stream.events.length = 0;

    const cancelled = await owner.delete(`${base()}/invitations/${invitation.body.id}`);
    expect(cancelled.status).toBeLessThan(300);
    await vi.waitFor(() =>
      expect(stream.events).toContainEqual({
        projectId: p,
        entityType: "other",
        entityId: null,
        operationType: "delete",
      }),
    );
  });

  it("stays quiet about writes marked private", async () => {
    const stream = await open(viewer);
    expect((await owner.post(`${base()}/notifications/read`, {})).status).toBeLessThan(300);
    const sentinel = await newOrg("After reading notifications");
    await delivered(stream, sentinel.body.id);
    expect(stream.events.map((e) => e.entityType)).not.toContain("other");
  });

  it("announces the worker's compile status changes", async () => {
    const doc = await owner.post(`${base()}/documents`, { kind: "resume", title: "Resume" });
    expect(doc.status).toBe(201);
    const version = await owner.post(`${base()}/documents/${doc.body.id}/versions/latex`, {
      source: "\\documentclass{article}\\begin{document}Hi\\end{document}",
      filename: "resume.tex",
    });
    expect(version.status).toBe(201);
    const stream = await open(viewer);

    const compiler = { compile: async () => ({ ok: false, log: "no" }) };
    const job = app.jobs.compiles.at(-1)!;
    expect(await runCompileJob({ db: app.db, blobs: app.blobs, compiler }, job)).toBe("failed");
    await vi.waitFor(() => expect(stream.events.filter((e) => e.entityId === doc.body.id)).toHaveLength(2));
  });

  it("announces the agenda digest to the projects it wrote notifications for", async () => {
    await owner.post(`${base()}/actions`, {
      type: "task",
      title: "Today",
      payload: {},
      scheduledAt: "2031-03-10T14:00:00.000Z",
    });
    const stream = await open(owner);
    expect(await runAgendaDigest(app.db, new Date("2031-03-10T08:05:00.000Z"))).toBe(1);
    await vi.waitFor(() =>
      expect(stream.events).toContainEqual({
        projectId: p,
        entityType: "notification",
        entityId: null,
        operationType: "create",
      }),
    );
  });
});

describe("MCP", () => {
  async function connect(client: Client) {
    const key = (await client.post("/api/auth/api-key/create", { name: "changes test" })).body.key as string;
    const mcp = new McpClient({ name: "test", version: "1.0.0" });
    const { mcpUrl } = (await client.get(base())).body;
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(mcpUrl), {
        requestInit: { headers: { "x-api-key": key } },
        fetch: async (input, init) => app.api.request(String(input).replace(PUBLIC_URL, ""), init as RequestInit),
      }),
    );
    return mcp;
  }
  const parsed = (result: unknown) =>
    JSON.parse(((result as { content: { text: string }[] }).content[0] as { text: string }).text);

  it("reaches the browser when an agent changes project data", async () => {
    const stream = await open(viewer);
    const mcp = await connect(owner);
    const org = parsed(
      await mcp.callTool({ name: "createOrganization", arguments: { kind: "company", name: "Agent" } }),
    );
    await delivered(stream, org.id);
    expect(stream.events).toContainEqual({
      projectId: p,
      entityType: "organization",
      entityId: org.id,
      operationType: "create",
    });
  });

  it("tells only the user about their own memory", async () => {
    const mine = await open(owner);
    const theirs = await open(viewer);
    const mcp = await connect(owner);
    const memory = await mcp.callTool({ name: "createUserMemory", arguments: { title: "Likes", content: "Tea" } });
    expect(memory.isError).toBeFalsy();
    await vi.waitFor(() =>
      expect(mine.events).toContainEqual(
        expect.objectContaining({ entityType: "other", operationType: "create", userId: expect.any(String) }),
      ),
    );
    const sentinel = await newOrg("After the memory");
    await delivered(theirs, sentinel.body.id);
    expect(theirs.events.filter((e) => "userId" in e)).toEqual([]);
  });

  it("covers every mutating tool: all go through the guard, and none opted out", async () => {
    const doc = (await anonymous(app).get("/api/openapi.json")).body;
    const tools = Object.values(doc.paths as Record<string, Record<string, Record<string, unknown>>>)
      .flatMap((methods) => Object.entries(methods))
      .filter(([method, op]) => method !== "get" && (op["x-mcp"] as { expose?: boolean })?.expose);
    expect(tools.length).toBeGreaterThan(25);
    for (const [, op] of tools) {
      expect(["project", "user"], String(op.operationId)).toContain(op["x-scope"]);
      expect(op["x-changes"], String(op.operationId)).toBeUndefined();
    }
  });
});
