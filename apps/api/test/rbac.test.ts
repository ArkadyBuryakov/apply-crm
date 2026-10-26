// RBAC matrix generated from the OpenAPI document (ADR 0022): every project-scoped operation × every role, plus a
// non-member. Requests use well-formed but non-existent IDs: the point is the authorization decision, not the result.
import { type Permission, PROJECT_ROLES, type ProjectRole, roleHas } from "@crm/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  anonymous,
  type Client,
  createTestApp,
  ownerWithProject,
  signUpInvited,
  type TestApp,
} from "./helpers.js";

type Operation = {
  operationId: string;
  method: string;
  path: string;
  permissions: Permission[];
  scope: string;
  pathParams: { name: string; pattern?: string }[];
};

const FIXTURE_BREAKING = ["deleteProject", "transferOwnership", "leaveProject"];

let app: TestApp;
let projectId: string;
const clients = {} as Record<ProjectRole | "outsider", Client>;
let operations: Operation[] = [];

function sampleId(pattern: string | undefined) {
  const prefix = pattern ? /^\^([a-z]+)_/.exec(pattern)?.[1] : undefined;
  return `${prefix ?? "xxx"}_01JBX3V6Q9W2G8K4M7N5P0R1S2`;
}

beforeAll(async () => {
  app = await createTestApp();
  const { owner, project } = await ownerWithProject(app);
  projectId = project.id;
  clients.owner = owner;
  clients.editor = await addMember(app, owner, projectId, "editor@example.test", "editor");
  clients.commenter = await addMember(app, owner, projectId, "commenter@example.test", "commenter");
  clients.viewer = await addMember(app, owner, projectId, "viewer@example.test", "viewer");
  clients.outsider = await signUpInvited(app, owner, "outsider@example.test");

  const doc = (await anonymous(app).get("/api/openapi.json")).body;
  for (const [path, methods] of Object.entries(doc.paths as Record<string, Record<string, Record<string, unknown>>>)) {
    for (const [method, op] of Object.entries(methods)) {
      const params = ((op.parameters as { name: string; in: string; schema?: { pattern?: string } }[]) ?? [])
        .filter((p) => p.in === "path")
        .map((p) => ({ name: p.name, pattern: p.schema?.pattern }));
      operations.push({
        operationId: op.operationId as string,
        method: method.toUpperCase(),
        path,
        permissions: op["x-permissions"] as Permission[],
        scope: op["x-scope"] as string,
        pathParams: params,
      });
    }
  }
  operations = operations.filter((o) => o.scope === "project");
});
afterAll(async () => {
  await app.close();
});

function urlFor(op: Operation) {
  let url = op.path;
  for (const p of op.pathParams) {
    const value = p.name === "projectId" ? projectId : p.name === "decision" ? "accept" : sampleId(p.pattern);
    url = url.replace(`{${p.name}}`, value);
  }
  return url;
}

async function call(client: Client, op: Operation) {
  return client.request(op.method, urlFor(op), ["POST", "PATCH", "PUT"].includes(op.method) ? {} : undefined, {
    "if-match": '"1"',
  });
}

describe("RBAC matrix", () => {
  it("covers every project-scoped operation", () => {
    expect(operations.length).toBeGreaterThan(60);
  });

  for (const role of PROJECT_ROLES) {
    it(`enforces declared permissions for ${role}`, async () => {
      const mismatches: string[] = [];
      for (const op of operations) {
        // Operations that change the caller's own membership would break the fixture for later checks;
        // they are covered by the projects tests.
        if (FIXTURE_BREAKING.includes(op.operationId)) continue;
        const allowed = roleHas(role, ...op.permissions);
        const res = await call(clients[role], op);
        if (allowed && res.status === 403) mismatches.push(`${op.operationId}: expected access, got 403`);
        if (!allowed && res.status !== 403) mismatches.push(`${op.operationId}: expected 403, got ${res.status}`);
        if (res.status >= 500) mismatches.push(`${op.operationId}: server error ${res.status}`);
      }
      expect(mismatches).toEqual([]);
    });
  }

  it("hides the project from non-members", async () => {
    const leaks: string[] = [];
    for (const op of operations) {
      const res = await call(clients.outsider, op);
      if (res.status !== 404) leaks.push(`${op.operationId}: ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it("requires authentication everywhere except public routes", async () => {
    const anon = anonymous(app);
    const open: string[] = [];
    for (const op of operations) {
      const res = await call(anon, op);
      if (res.status !== 401) open.push(`${op.operationId}: ${res.status}`);
    }
    expect(open).toEqual([]);
  });
});
