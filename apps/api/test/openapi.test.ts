import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonymous, createTestApp, type TestApp } from "./helpers.js";

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

type Operation = {
  operationId: string;
  summary?: string;
  description?: string;
  "x-scope": string;
  "x-permissions": string[];
  "x-mcp"?: { expose: boolean };
  requestBody?: { content: Record<string, { schema: Record<string, unknown> }> };
};

describe("OpenAPI document", () => {
  it("is served and annotates every operation", async () => {
    const res = await anonymous(app).get("/api/openapi.json");
    expect(res.status).toBe(200);
    const doc = res.body;
    expect(doc.openapi).toBe("3.1.0");
    const ops: Operation[] = Object.values(doc.paths as Record<string, Record<string, Operation>>).flatMap((p) =>
      Object.values(p),
    );
    expect(ops.length).toBeGreaterThan(40);
    const ids = new Set<string>();
    for (const op of ops) {
      expect(op.operationId).toBeTruthy();
      expect(ids.has(op.operationId)).toBe(false);
      ids.add(op.operationId);
      expect(op.summary, op.operationId).toBeTruthy();
      expect(op.description, op.operationId).toBeTruthy();
      expect(["public", "user", "instance_admin", "project"]).toContain(op["x-scope"]);
      expect(Array.isArray(op["x-permissions"])).toBe(true);
      if (op["x-scope"] === "project") expect(op["x-permissions"].length, op.operationId).toBeGreaterThan(0);
    }
  });

  it("publishes only flag-free regex patterns", async () => {
    const text = JSON.stringify((await anonymous(app).get("/api/openapi.json")).body);
    const patterns = [...text.matchAll(/"pattern":"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
    expect(patterns.length).toBeGreaterThan(0);
    for (const p of patterns) expect(p.endsWith("$") || p.endsWith(")")).toBe(true);
  });

  it("describes action creation as a discriminated union", async () => {
    const doc = (await anonymous(app).get("/api/openapi.json")).body;
    const schema = doc.components.schemas.CreateAction;
    expect(schema.oneOf).toHaveLength(10);
    expect(schema.discriminator?.propertyName).toBe("type");
  });
});
