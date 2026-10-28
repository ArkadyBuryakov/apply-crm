import { createDb } from "@crm/db";
import { inject } from "vitest";
import { type Api, createApi } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { loadEnv } from "../src/env.js";
import { MemoryBlobStore } from "../src/services/blobs.js";
import { MemoryJobQueue } from "../src/services/jobs.js";
import { FakeAi } from "./fake-ai.js";
import { withDatabase } from "./global-setup.js";

export const PUBLIC_URL = "http://localhost:3000";

/** A fresh database cloned from the migrated template, plus an API instance wired to in-memory infrastructure. */
export async function createTestApp() {
  const baseUrl = inject("databaseUrl");
  const name = `t_${Math.random().toString(36).slice(2, 10)}`;
  const admin = createDb(baseUrl, { max: 1 });
  await admin.client.unsafe(`create database ${name} template crm_template`);
  await admin.client.end();

  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: withDatabase(baseUrl, name),
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123",
    PUBLIC_URL,
  });
  const { db, client } = createDb(env.DATABASE_URL, { max: 5 });
  const auth = createAuth(db, env);
  const blobs = new MemoryBlobStore();
  const jobs = new MemoryJobQueue();
  const ai = new FakeAi();
  const api = createApi({ db, auth, env, services: { blobs, jobs, ai } });
  return { api, db, auth, env, blobs, jobs, ai, close: () => client.end() };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** An HTTP client bound to one signed-in user. */
export class Client {
  constructor(
    private readonly api: Api,
    readonly headers: Record<string, string>,
    readonly user: { id: string; email: string },
  ) {}

  async request(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const res = await this.api.request(path, {
      method,
      headers: {
        origin: PUBLIC_URL,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...this.headers,
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    // biome-ignore lint/suspicious/noExplicitAny: test convenience
    return { status: res.status, body: json as any, headers: res.headers };
  }

  /** Sends a multipart form with the given files under `field`. */
  async upload(path: string, field: string, files: { name: string; content: string | Uint8Array; type: string }[]) {
    const form = new FormData();
    for (const f of files) form.append(field, new File([f.content], f.name, { type: f.type }));
    const res = await this.api.request(path, {
      method: "POST",
      body: form,
      headers: { origin: PUBLIC_URL, ...this.headers },
    });
    const text = await res.text();
    // biome-ignore lint/suspicious/noExplicitAny: test convenience
    return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
  }

  /** Raw GET, for binary downloads. */
  raw(path: string) {
    return this.api.request(path, { headers: this.headers });
  }

  get = (path: string, h?: Record<string, string>) => this.request("GET", path, undefined, h);
  post = (path: string, body?: unknown, h?: Record<string, string>) => this.request("POST", path, body ?? {}, h);
  patch = (path: string, body: unknown, h?: Record<string, string>) => this.request("PATCH", path, body, h);
  delete = (path: string, h?: Record<string, string>) => this.request("DELETE", path, undefined, h);
}

const PASSWORD = "correct horse battery";

async function authenticate(app: TestApp, path: string, payload: Record<string, string>): Promise<Client> {
  const res = await app.api.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: PUBLIC_URL },
    body: JSON.stringify(payload),
  });
  if (res.status !== 200) throw new Error(`${path} failed (${res.status}): ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const body = (await res.json()) as { user: { id: string; email: string } };
  return new Client(app.api, { cookie }, body.user);
}

export function signUp(app: TestApp, email: string, name = email.split("@")[0]!): Promise<Client> {
  return authenticate(app, "/api/auth/sign-up/email", { email, password: PASSWORD, name });
}

export function signIn(app: TestApp, email: string): Promise<Client> {
  return authenticate(app, "/api/auth/sign-in/email", { email, password: PASSWORD });
}

/** Signs up `email` after the instance admin allowed it (sign-up is invite-only after the first user). */
export async function signUpInvited(app: TestApp, admin: Client, email: string): Promise<Client> {
  const res = await admin.post("/api/admin/invitations", { email });
  if (res.status !== 201) throw new Error(`instance invitation failed: ${JSON.stringify(res.body)}`);
  return signUp(app, email);
}

export function anonymous(app: TestApp) {
  return new Client(app.api, {}, { id: "", email: "" });
}

/** Signs up an owner and returns them with a fresh project. */
export async function ownerWithProject(app: TestApp, email = "owner@example.test") {
  const owner = await signUp(app, email);
  const res = await owner.post("/api/projects", { name: "Job search" });
  if (res.status !== 201) throw new Error(`project creation failed: ${JSON.stringify(res.body)}`);
  return { owner, project: res.body as { id: string; mcpUrl: string } };
}

/** Invites `email` with `role`, lets the instance admin allow the sign-up, and accepts the invitation. */
export async function addMember(app: TestApp, owner: Client, projectId: string, email: string, role: string) {
  const invite = await owner.post(`/api/projects/${projectId}/invitations`, { email, role });
  if (invite.status !== 201) throw new Error(`invite failed: ${JSON.stringify(invite.body)}`);
  const member = await signUp(app, email);
  const accepted = await member.post(`/api/invitations/${invite.body.id}/accept`);
  if (accepted.status !== 204) throw new Error(`accept failed: ${JSON.stringify(accepted.body)}`);
  return member;
}
