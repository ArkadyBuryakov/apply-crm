import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, anonymous, createTestApp, signIn, signUp, signUpInvited, type TestApp } from "./helpers.js";

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe("sign-up and projects", () => {
  it("makes the first user instance admin, then requires invitations", async () => {
    const first = await signUp(app, "first@example.test");
    const me = await first.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.isInstanceAdmin).toBe(true);
    expect(me.body.id).toMatch(/^usr_/);

    await expect(signUp(app, "stranger@example.test")).rejects.toThrow(/403/);

    const invite = await first.post("/api/admin/invitations", { email: "friend@example.test" });
    expect(invite.status).toBe(201);
    const friend = await signUp(app, "friend@example.test");
    expect((await friend.get("/api/me")).body.isInstanceAdmin).toBe(false);
    expect((await friend.get("/api/admin/invitations")).status).toBe(403);
  });

  it("rejects anonymous calls", async () => {
    const res = await anonymous(app).get("/api/projects");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthenticated");
  });

  it("creates seeded projects, manages members and transfers ownership", async () => {
    const admin = await signIn(app, "first@example.test");
    const owner = await signUpInvited(app, admin, "owner@example.test");
    const created = await owner.post("/api/projects", { name: "Job search 2026" });
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(/^prj_/);
    expect(created.body.role).toBe("owner");
    expect(created.body.mcpUrl).toBe(`http://localhost:3000/mcp/projects/${created.body.id}`);
    const projectId = created.body.id as string;

    const listed = await owner.get("/api/projects");
    expect(listed.body.items.map((p: { id: string }) => p.id)).toContain(projectId);

    const coach = await addMember(app, owner, projectId, "coach@example.test", "commenter");
    const coachView = await coach.get(`/api/projects/${projectId}`);
    expect(coachView.status).toBe(200);
    expect(coachView.body.role).toBe("commenter");
    expect(coachView.body.permissions).toContain("comment:create");
    expect(coachView.body.permissions).not.toContain("position:create");

    // Commenters cannot manage members; non-members cannot see the project at all.
    expect(
      (await coach.post(`/api/projects/${projectId}/invitations`, { email: "x@example.test", role: "viewer" })).status,
    ).toBe(403);
    const outsider = await signUpInvited(app, admin, "outsider@example.test");
    expect((await outsider.get(`/api/projects/${projectId}`)).status).toBe(404);

    // The owner cannot be demoted directly or leave; ownership transfer swaps roles.
    expect((await owner.post(`/api/projects/${projectId}/leave`)).status).toBe(400);
    const members = await owner.get(`/api/projects/${projectId}/members`);
    const coachMember = members.body.items.find((m: { email: string }) => m.email === "coach@example.test");
    expect(
      (await owner.post(`/api/projects/${projectId}/transfer-ownership`, { userId: coachMember.userId })).status,
    ).toBe(204);
    expect((await coach.get(`/api/projects/${projectId}`)).body.role).toBe("owner");
    expect((await owner.get(`/api/projects/${projectId}`)).body.role).toBe("editor");
    expect((await owner.post(`/api/projects/${projectId}/leave`)).status).toBe(204);
    expect((await owner.get(`/api/projects/${projectId}`)).status).toBe(404);
  });
});
