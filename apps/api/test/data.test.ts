import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, createTestApp, ownerWithProject, type TestApp } from "./helpers.js";

let app: TestApp;
let owner: Client;
let p: string;
const base = (id = p) => `/api/projects/${id}`;

beforeAll(async () => {
  app = await createTestApp();
  const created = await ownerWithProject(app);
  owner = created.owner;
  p = created.project.id;
});
afterAll(async () => {
  await app.close();
});

describe("export and import", () => {
  it("round-trips a project into another project with new IDs", async () => {
    const company = (await owner.post(`${base()}/organizations`, { kind: "company", name: "Hooli" })).body;
    const email = (await owner.get(`${base()}/channels`)).body.items.find(
      (c: { name: string }) => c.name === "Email",
    ).id;
    const person = (
      await owner.post(`${base()}/contacts`, {
        name: "Gavin",
        affiliations: [{ organizationId: company.id, title: "CEO" }],
        handles: [{ channelId: email, value: "gavin@hooli.example" }],
      })
    ).body;
    const pos = (await owner.post(`${base()}/positions`, { title: "Compression engineer", companyId: company.id }))
      .body;
    const doc = (await owner.post(`${base()}/documents`, { kind: "resume", title: "Resume", positionId: pos.id })).body;
    const version = await owner.upload(`${base()}/documents/${doc.id}/versions/upload`, "file", [
      { name: "resume.pdf", content: "%PDF resume", type: "application/pdf" },
    ]);
    const call = (
      await owner.post(`${base()}/actions`, {
        type: "meeting",
        title: "Intro",
        status: "done",
        payload: { format: "phone" },
        subjects: [{ positionId: pos.id }],
        participants: [{ contactId: person.id, role: "attendee" }],
      })
    ).body.action;
    const applied = (
      await owner.post(`${base()}/log-interaction`, {
        action: {
          type: "application",
          title: "Applied",
          status: "done",
          payload: { method: "email" },
          subjects: [{ positionId: pos.id }],
          attachments: [version.body.id],
        },
        previousActionId: call.id,
      })
    ).body;
    await owner.post(`${base()}/comments`, { targetType: "position", targetId: pos.id, body: "Dream job" });

    const exported = await owner.raw(`${base()}/export`);
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("application/zip");
    const zip = new Uint8Array(await exported.arrayBuffer());

    const target = (await owner.post("/api/projects", { name: "Copy" })).body.id;
    const imported = await owner.upload(`${base(target)}/import`, "file", [
      { name: "export.zip", content: zip, type: "application/zip" },
    ]);
    expect(imported.status).toBe(201);
    expect(imported.body).toMatchObject({
      organizations: 1,
      contacts: 1,
      positions: 1,
      actions: 2,
      edges: 1,
      documents: 1,
      comments: 1,
    });
    // Seeded channels and stages were matched, not duplicated.
    expect(imported.body.channels).toBe(0);
    expect(imported.body.stages).toBe(0);

    const positions = (await owner.get(`${base(target)}/positions`)).body.items;
    expect(positions).toHaveLength(1);
    expect(positions[0].id).not.toBe(pos.id);
    expect(positions[0].company.name).toBe("Hooli");
    const overview = (await owner.get(`${base(target)}/positions/${positions[0].id}/overview`)).body;
    expect(overview.timeline).toHaveLength(2);
    expect(overview.edges).toHaveLength(1);
    expect(overview.contacts[0].handles[0].value).toBe("gavin@hooli.example");
    const app2 = overview.timeline.find((a: { type: string }) => a.type === "application");
    expect(app2.attachments).toHaveLength(1);
    expect(app2.attachments[0]).not.toBe(applied.action.attachments[0]);
    const docs = (await owner.get(`${base(target)}/documents`)).body.items;
    const file = await owner.raw(`${base(target)}/documents/${docs[0].id}/versions/${docs[0].versions[0].id}/file`);
    expect(await file.text()).toBe("%PDF resume");

    // The source project is untouched.
    expect((await owner.get(`${base()}/positions`)).body.items).toHaveLength(1);
  });

  it("rejects garbage archives", async () => {
    const res = await owner.upload(`${base()}/import`, "file", [
      { name: "x.zip", content: "nope", type: "application/zip" },
    ]);
    expect(res.status).toBe(400);
  });

  it("imports positions from CSV", async () => {
    const csv =
      'title,company,stage,salary_min,currency,notes\n"Rust dev, backend",Pied Piper,applied,"100 000",eur,"said ""hi"""\nSRE,Pied Piper,,,,\n';
    const res = await owner.upload(`${base()}/import/positions.csv`, "file", [
      { name: "p.csv", content: csv, type: "text/csv" },
    ]);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ positions: 2, organizations: 1 });
    const list = (await owner.get(`${base()}/positions?q=rust`)).body.items;
    expect(list[0]).toMatchObject({ title: "Rust dev, backend", stageKey: "applied", notes: 'said "hi"' });
    expect(list[0].salary).toMatchObject({ min: 100000, currency: "EUR" });
  });
});
