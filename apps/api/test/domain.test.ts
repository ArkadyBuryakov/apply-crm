import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, type Client, createTestApp, ownerWithProject, type TestApp } from "./helpers.js";

let app: TestApp;
let owner: Client;
let p: string;
const base = () => `/api/projects/${p}`;

beforeAll(async () => {
  app = await createTestApp();
  const created = await ownerWithProject(app);
  owner = created.owner;
  p = created.project.id;
});
afterAll(async () => {
  await app.close();
});

async function org(kind: "company" | "agency", name: string) {
  const res = await owner.post(`${base()}/organizations`, { kind, name });
  expect(res.status).toBe(201);
  return res.body as { id: string; version: number };
}

async function channelId(name: string) {
  const res = await owner.get(`${base()}/channels`);
  return res.body.items.find((c: { name: string }) => c.name === name).id as string;
}

describe("organizations", () => {
  it("enforces optimistic concurrency and supports soft delete", async () => {
    const acme = await org("company", "Acme Robotics");
    expect(acme.id).toMatch(/^org_/);

    const noVersion = await owner.patch(`${base()}/organizations/${acme.id}`, { website: "https://acme.example" });
    expect(noVersion.status).toBe(428);

    const updated = await owner.patch(
      `${base()}/organizations/${acme.id}`,
      { website: "https://acme.example" },
      { "if-match": '"1"' },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.version).toBe(2);
    expect(updated.headers.get("etag")).toBe('"2"');

    const stale = await owner.patch(`${base()}/organizations/${acme.id}`, { name: "Acme", version: 1 });
    expect(stale.status).toBe(412);
    expect(stale.body.error.details.currentVersion).toBe(2);

    expect((await owner.get(`${base()}/organizations?q=acm`)).body.items).toHaveLength(1);
    expect((await owner.delete(`${base()}/organizations/${acme.id}?version=2`)).status).toBe(204);
    expect((await owner.get(`${base()}/organizations/${acme.id}`)).status).toBe(404);
    expect((await owner.get(`${base()}/organizations?deleted=true`)).body.items).toHaveLength(1);
    expect((await owner.post(`${base()}/organizations/${acme.id}/restore`)).status).toBe(204);
    expect((await owner.get(`${base()}/organizations/${acme.id}`)).body.version).toBe(4);
  });

  it("validates input and IDs", async () => {
    expect((await owner.post(`${base()}/organizations`, { kind: "school", name: "X" })).status).toBe(422);
    expect((await owner.get(`${base()}/organizations/pos_01JBX3V6Q9W2G8K4M7N5P0R1S2`)).status).toBe(422);
  });
});

describe("contacts", () => {
  it("creates contacts with affiliations and handles, finds them by email, purges them", async () => {
    const agency = await org("agency", "Talent Bridge");
    const email = await channelId("Email");
    const created = await owner.post(`${base()}/contacts`, {
      name: "Dana Recruiter",
      affiliations: [{ organizationId: agency.id, title: "Senior recruiter", from: "2023-01-01" }],
      handles: [{ channelId: email, value: "dana@talentbridge.example" }],
    });
    expect(created.status).toBe(201);
    expect(created.body.affiliations[0].organizationName).toBe("Talent Bridge");
    expect(created.body.handles[0].channelName).toBe("Email");
    const contactId = created.body.id;

    expect((await owner.get(`${base()}/contacts?q=talentbridge`)).body.items).toHaveLength(1);
    expect((await owner.get(`${base()}/contacts?organizationId=${agency.id}`)).body.items).toHaveLength(1);

    const affiliation = created.body.affiliations[0];
    const ended = await owner.patch(`${base()}/contacts/${contactId}/affiliations/${affiliation.id}`, {
      to: "2020-01-01",
      version: affiliation.version,
    });
    expect(ended.status).toBe(200);
    expect(ended.body.affiliations[0].to).toBe("2020-01-01");
    expect((await owner.get(`${base()}/contacts?organizationId=${agency.id}`)).body.items).toHaveLength(0);

    expect((await owner.post(`${base()}/contacts/${contactId}/purge`)).status).toBe(204);
    expect((await owner.get(`${base()}/contacts/${contactId}`)).status).toBe(404);
    const auditLog = await owner.get(`${base()}/audit?entityId=${contactId}`);
    const ops = auditLog.body.items.map((e: { op: string }) => e.op);
    expect(ops).toContain("purge");
    const create = auditLog.body.items.find((e: { op: string }) => e.op === "create");
    expect(create.diff).toEqual({ redacted: true });
    expect(JSON.stringify(auditLog.body)).not.toContain("Dana");
  });
});

describe("positions and actions", () => {
  it("validates organization kinds and defaults the stage", async () => {
    const agency = await org("agency", "Hire Partners");
    const wrong = await owner.post(`${base()}/positions`, { title: "Backend engineer", companyId: agency.id });
    expect(wrong.status).toBe(400);

    const pos = await owner.post(`${base()}/positions`, {
      title: "Backend engineer",
      agencyId: agency.id,
      salary: { min: 90000, max: 110000, currency: "eur", period: "year" },
    });
    expect(pos.status).toBe(201);
    expect(pos.body.stageKey).toBe("saved");
    expect(pos.body.company).toBeNull();
    expect(pos.body.agency.name).toBe("Hire Partners");
    expect(pos.body.salary.currency).toBe("EUR");
  });

  it("logs actions with suggestions, rejection stage capture and reschedules", async () => {
    const company = await org("company", "Globex");
    const pos = (await owner.post(`${base()}/positions`, { title: "Staff engineer", companyId: company.id })).body;

    const badPayload = await owner.post(`${base()}/actions`, {
      type: "interview",
      title: "Tech interview",
      payload: { kind: "technical" },
      subjects: [{ positionId: pos.id }],
    });
    expect(badPayload.status).toBe(422);

    const badStatus = await owner.post(`${base()}/actions`, {
      type: "email",
      title: "x",
      status: "no_show",
      payload: { direction: "outbound" },
    });
    expect(badStatus.status).toBe(400);

    const applied = await owner.post(`${base()}/actions`, {
      type: "application",
      title: "Applied on careers site",
      status: "done",
      payload: { method: "portal" },
      subjects: [{ positionId: pos.id }],
    });
    expect(applied.status).toBe(201);
    expect(applied.body.action.completedAt).not.toBeNull();
    expect(applied.body.suggestions).toEqual([
      expect.objectContaining({ positionId: pos.id, kind: "stage", stageKey: "applied" }),
    ]);

    // Organization timelines include actions about its positions.
    const byOrg = await owner.get(`${base()}/actions?organizationId=${company.id}`);
    expect(byOrg.body.items.map((a: { id: string }) => a.id)).toContain(applied.body.action.id);

    const interview = await owner.post(`${base()}/actions`, {
      type: "interview",
      title: "Tech interview",
      scheduledAt: "2030-01-10T10:00:00.000Z",
      payload: { kind: "technical", format: "video" },
      subjects: [{ positionId: pos.id }],
    });
    expect(interview.body.action.status).toBe("planned");

    const rescheduled = await owner.post(`${base()}/actions/${interview.body.action.id}/reschedule`, {
      scheduledAt: "2030-01-12T10:00:00.000Z",
      version: 1,
    });
    expect(rescheduled.status).toBe(201);
    expect(rescheduled.body.status).toBe("planned");
    expect(rescheduled.body.scheduledAt).toBe("2030-01-12T10:00:00.000Z");
    expect(rescheduled.body.subjects).toEqual([{ positionId: pos.id }]);
    const old = await owner.get(`${base()}/actions/${interview.body.action.id}`);
    expect(old.body.status).toBe("rescheduled");
    const graph = await owner.get(`${base()}/actions/${rescheduled.body.id}/graph?direction=ancestors`);
    expect(graph.body.edges).toEqual([
      expect.objectContaining({
        parentId: interview.body.action.id,
        childId: rescheduled.body.id,
        kind: "rescheduled",
      }),
    ]);

    const rejection = await owner.post(`${base()}/actions`, {
      type: "rejection",
      title: "Rejected after tech interview",
      payload: { by: "company" },
      subjects: [{ positionId: pos.id }],
    });
    expect(rejection.body.action.payload.stageKey).toBe("saved");
    expect(rejection.body.suggestions).toEqual([expect.objectContaining({ kind: "outcome", outcome: "rejected" })]);
  });

  it("merges payload patches and validates them against the type", async () => {
    const note = await owner.post(`${base()}/actions`, {
      type: "task",
      title: "Update resume",
      payload: { priority: "low" },
    });
    const id = note.body.action.id;
    const patched = await owner.patch(`${base()}/actions/${id}`, {
      payload: { checklist: [{ text: "skills", done: false }] },
      version: 1,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.action.payload).toEqual({ priority: "low", checklist: [{ text: "skills", done: false }] });
    const bad = await owner.patch(`${base()}/actions/${id}`, { payload: { priority: "urgent" }, version: 2 });
    expect(bad.status).toBe(422);
  });
});

describe("graph", () => {
  async function task(title: string) {
    return (await owner.post(`${base()}/actions`, { type: "task", title, payload: {} })).body.action.id as string;
  }

  it("links actions, reports cycles and traverses safely", async () => {
    const a = await task("A");
    const b = await task("B");
    const c = await task("C");
    expect((await owner.post(`${base()}/actions/${a}/edges`, { childId: b, kind: "follow_up" })).body.warnings).toEqual(
      [],
    );
    expect((await owner.post(`${base()}/actions/${b}/edges`, { childId: c, kind: "follow_up" })).status).toBe(201);
    const cycle = await owner.post(`${base()}/actions/${c}/edges`, { childId: a, kind: "related" });
    expect(cycle.status).toBe(201);
    expect(cycle.body.warnings).toEqual(["cycle"]);
    expect((await owner.post(`${base()}/actions/${a}/edges`, { childId: b, kind: "follow_up" })).status).toBe(409);
    expect((await owner.post(`${base()}/actions/${a}/edges`, { childId: a, kind: "related" })).status).toBe(400);

    const all = await owner.get(`${base()}/actions/${a}/graph?direction=descendants&maxDepth=20`);
    expect(all.status).toBe(200);
    expect(all.body.nodes).toHaveLength(3);
    expect(all.body.edges).toHaveLength(3);

    const shallow = await owner.get(`${base()}/actions/${a}/graph?direction=descendants&maxDepth=1`);
    expect(shallow.body.nodes.map((n: { id: string }) => n.id).sort()).toEqual([a, b].sort());
    expect(shallow.body.truncated).toBe(true);

    expect((await owner.delete(`${base()}/actions/${c}/edges/${a}?kind=related`)).status).toBe(204);
    expect((await owner.delete(`${base()}/actions/${c}/edges/${a}?kind=related`)).status).toBe(404);
  });

  it("logs an interaction linked to the previous action", async () => {
    const prev = await task("Prep");
    const res = await owner.post(`${base()}/log-interaction`, {
      action: { type: "note", title: "Thoughts after prep" },
      previousActionId: prev,
    });
    expect(res.status).toBe(201);
    expect(res.body.edge).toEqual(
      expect.objectContaining({ parentId: prev, childId: res.body.action.id, kind: "follow_up" }),
    );
  });
});

describe("composite views", () => {
  it("builds an overview, agenda and search results", async () => {
    const company = await org("company", "Initech");
    const email = await channelId("Email");
    const person = (
      await owner.post(`${base()}/contacts`, {
        name: "Peter Hiring",
        affiliations: [{ organizationId: company.id }],
        handles: [{ channelId: email, value: "peter@initech.example" }],
      })
    ).body;
    const pos = (await owner.post(`${base()}/positions`, { title: "Platform engineer", companyId: company.id })).body;
    const soon = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    await owner.post(`${base()}/actions`, {
      type: "meeting",
      title: "Hiring manager chat",
      scheduledAt: soon,
      payload: { format: "video" },
      subjects: [{ positionId: pos.id }],
      participants: [{ contactId: person.id, role: "attendee" }],
    });
    await owner.post(`${base()}/actions`, {
      type: "task",
      title: "Send portfolio",
      dueAt: past,
      payload: {},
      subjects: [{ positionId: pos.id }],
    });
    await owner.post(`${base()}/actions`, {
      type: "task",
      title: "Take-home exercise",
      scheduledAt: past,
      dueAt: soon,
      payload: {},
      subjects: [{ positionId: pos.id }],
    });

    const overview = await owner.get(`${base()}/positions/${pos.id}/overview`);
    expect(overview.status).toBe(200);
    expect(overview.body.company.name).toBe("Initech");
    expect(overview.body.timeline).toHaveLength(3);
    expect(overview.body.contacts.map((c: { name: string }) => c.name)).toEqual(["Peter Hiring"]);

    const agenda = await owner.get(`${base()}/agenda`);
    expect(agenda.status).toBe(200);
    const titles = (list: { title: string }[]) => list.map((a) => a.title);
    expect(titles(agenda.body.overdue)).toEqual(["Send portfolio"]);
    expect(titles(agenda.body.today)).toEqual(["Take-home exercise"]);
    expect(titles(agenda.body.upcoming)).toEqual(["Hiring manager chat"]);

    const hits = await owner.get(`${base()}/search?q=initech`);
    const types = hits.body.items.map((h: { type: string }) => h.type);
    expect(types).toContain("organization");
    expect(types).toContain("contact");

    const graph = await owner.get(`${base()}/graph?positionId=${pos.id}`);
    expect(graph.body.nodes).toHaveLength(3);
  });
});

describe("comments and notifications", () => {
  it("lets commenters comment, notifies the creator, blocks viewers", async () => {
    const company = await org("company", "Umbrella");
    const coach = await addMember(app, owner, p, "coach@example.test", "commenter");
    const viewer = await addMember(app, owner, p, "viewer@example.test", "viewer");

    const res = await coach.post(`${base()}/comments`, {
      targetType: "organization",
      targetId: company.id,
      body: "Ask about remote",
    });
    expect(res.status).toBe(201);
    expect(res.body.authorName).toBe("coach");
    expect(
      (await viewer.post(`${base()}/comments`, { targetType: "organization", targetId: company.id, body: "hi" }))
        .status,
    ).toBe(403);
    expect((await coach.post(`${base()}/organizations`, { kind: "company", name: "Nope" })).status).toBe(403);

    const listed = await viewer.get(`${base()}/comments?targetType=organization&targetId=${company.id}`);
    expect(listed.body.items).toHaveLength(1);

    const notifications = await owner.get(`${base()}/notifications?unread=true`);
    expect(notifications.body.items[0].message).toContain("Ask about remote");
    expect((await owner.post(`${base()}/notifications/read`, {})).status).toBe(204);
    expect((await owner.get(`${base()}/notifications?unread=true`)).body.items).toHaveLength(0);

    // Owners can moderate; commenters cannot delete others' comments.
    const ownerComment = await owner.post(`${base()}/comments`, {
      targetType: "organization",
      targetId: company.id,
      body: "ok",
    });
    expect((await coach.delete(`${base()}/comments/${ownerComment.body.id}`)).status).toBe(403);
    expect((await owner.delete(`${base()}/comments/${res.body.id}`)).status).toBe(204);
  });
});
