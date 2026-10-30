import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgendaDigest } from "../src/services/digest.js";
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

const task = (title: string, fields: Record<string, unknown>) =>
  owner.post(`${base()}/actions`, { type: "task", title, payload: {}, ...fields });

describe("agenda digest", () => {
  it("tells each member once, in their 8 o'clock hour, how many tasks are on today's agenda", async () => {
    // The owner is in UTC; a teammate in Berlin (UTC+1 in January) gets their digest an hour earlier.
    const teammate = await addMember(app, owner, p, "berlin@example.test", "editor");
    expect((await teammate.patch("/api/me", { timezone: "Europe/Berlin" })).status).toBe(200);
    const members = (await owner.get(`${base()}/members`)).body.items;
    const teammateId = members.find((m: { email: string }) => m.email === "berlin@example.test").userId;

    await task("Teammate's", { scheduledAt: "2030-01-10T15:00:00.000Z", assigneeId: teammateId });
    await task("Prepare for interview", { scheduledAt: "2030-01-10T14:00:00.000Z" });
    await task("Take-home", { scheduledAt: "2030-01-08T09:00:00.000Z", dueAt: "2030-01-11T17:00:00.000Z" });
    await task("Tomorrow", { scheduledAt: "2030-01-11T09:00:00.000Z" });
    await task("Overdue", { dueAt: "2030-01-09T09:00:00.000Z" });
    await task("Done today", { scheduledAt: "2030-01-10T09:00:00.000Z", status: "done" });

    expect(await runAgendaDigest(app.db, new Date("2030-01-10T06:55:00.000Z"))).toBe(0);
    expect(await runAgendaDigest(app.db, new Date("2030-01-10T07:05:00.000Z"))).toBe(1); // 08:05 in Berlin
    expect(await runAgendaDigest(app.db, new Date("2030-01-10T08:05:00.000Z"))).toBe(1); // 08:05 in UTC
    expect(await runAgendaDigest(app.db, new Date("2030-01-10T08:15:00.000Z"))).toBe(0);
    expect(await runAgendaDigest(app.db, new Date("2030-01-10T09:05:00.000Z"))).toBe(0);

    const mine = (await owner.get(`${base()}/notifications`)).body.items;
    expect(mine).toEqual([
      expect.objectContaining({
        kind: "agenda",
        entityType: "agenda",
        entityId: null,
        message: "You have 2 new tasks today",
      }),
    ]);
    const theirs = (await teammate.get(`${base()}/notifications`)).body.items;
    expect(theirs.map((n: { message: string }) => n.message)).toContain("You have 1 new task today");

    // The next morning is a new day and gets its own digest; a day with nothing on the agenda gets none.
    expect(await runAgendaDigest(app.db, new Date("2030-01-11T08:05:00.000Z"))).toBe(1); // Take-home and Tomorrow
    expect(await runAgendaDigest(app.db, new Date("2030-01-13T08:05:00.000Z"))).toBe(0);
  });
});
