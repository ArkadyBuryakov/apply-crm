import { expect, test } from "@playwright/test";

// Not part of the suite by default: captures screenshots of key pages with seeded data for visual review.
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=dir to capture");

test("capture", async ({ page }) => {
  const request = page.request;
  const out = process.env.SCREENSHOTS!;
  const phone = test.info().project.name === "phone";
  const shot = (name: string) =>
    page.screenshot({ path: `${out}/${test.info().project.name}-${name}.png`, fullPage: true });
  const res = await request.post("/api/auth/sign-in/email", {
    data: { email: "ada@example.test", password: "correct horse battery" },
    headers: { origin: "http://localhost:3100" },
  });
  if (!res.ok()) {
    await request.post("/api/auth/sign-up/email", {
      data: { email: "ada@example.test", password: "correct horse battery", name: "Ada" },
      headers: { origin: "http://localhost:3100" },
    });
  }
  const h = { origin: "http://localhost:3100" };
  const post = async (path: string, data: unknown) => (await request.post(path, { data, headers: h })).json();
  const project = await post("/api/projects", { name: "Job search 2026" });
  const p = `/api/projects/${project.id}`;
  const acme = await post(`${p}/organizations`, {
    kind: "company",
    name: "Acme Robotics",
    website: "https://acme.example",
  });
  const globex = await post(`${p}/organizations`, { kind: "company", name: "Globex" });
  const talent = await post(`${p}/organizations`, { kind: "agency", name: "Talent Bridge" });
  const channels = (await (await request.get(`${p}/channels`)).json()).items;
  const email = channels.find((c: { name: string }) => c.name === "Email").id;
  const dana = await post(`${p}/contacts`, {
    name: "Dana Recruiter",
    affiliations: [{ organizationId: talent.id, title: "Senior recruiter" }],
    handles: [{ channelId: email, value: "dana@talentbridge.example" }],
  });
  const stages = (await (await request.get(`${p}/stages`)).json()).items;
  const stage = (key: string) => stages.find((s: { key: string }) => s.key === key).id;
  const staff = await post(`${p}/positions`, {
    title: "Staff engineer",
    companyId: acme.id,
    agencyId: talent.id,
    stageId: stage("interviewing"),
    salary: { min: 120000, max: 140000, currency: "EUR", period: "year" },
  });
  await post(`${p}/positions`, { title: "Platform engineer", companyId: globex.id, stageId: stage("applied") });
  await post(`${p}/positions`, { title: "Backend engineer", agencyId: talent.id, stageId: stage("screening") });
  await post(`${p}/positions`, { title: "Engineering manager", companyId: globex.id });
  const intro = await post(`${p}/actions`, {
    type: "meeting",
    title: "Intro call with Dana",
    status: "done",
    completedAt: "2026-10-12T09:00:00Z",
    payload: { format: "phone", durationMin: 30 },
    subjects: [{ positionId: staff.id }],
    participants: [{ contactId: dana.id, role: "attendee" }],
  });
  const applied = await post(`${p}/log-interaction`, {
    action: {
      type: "application",
      title: "Applied via agency",
      status: "done",
      completedAt: "2026-10-13T09:00:00Z",
      payload: { method: "agency" },
      subjects: [{ positionId: staff.id }],
    },
    previousActionId: intro.action.id,
  });
  const screen = await post(`${p}/log-interaction`, {
    action: {
      type: "interview",
      title: "Screening with HR",
      status: "done",
      completedAt: "2026-10-18T09:00:00Z",
      payload: { kind: "screening", format: "video", round: 1 },
      subjects: [{ positionId: staff.id }],
    },
    previousActionId: applied.action.id,
  });
  const tech = await post(`${p}/log-interaction`, {
    action: {
      type: "interview",
      title: "System design interview",
      scheduledAt: new Date(Date.now() + 2 * 86400000).toISOString(),
      payload: { kind: "system_design", format: "video", round: 2 },
      subjects: [{ positionId: staff.id }],
    },
    previousActionId: screen.action.id,
  });
  await post(`${p}/log-interaction`, {
    action: {
      type: "take_home",
      title: "Take-home: rate limiter",
      dueAt: new Date(Date.now() - 86400000).toISOString(),
      payload: { estimatedHours: 4 },
      subjects: [{ positionId: staff.id }],
    },
    previousActionId: screen.action.id,
  });
  await post(`${p}/actions`, {
    type: "task",
    title: "Prepare questions for the panel",
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    payload: { priority: "high" },
    subjects: [{ positionId: staff.id }],
  });
  void tech;

  await page.goto(`/p/${project.id}/pipeline`);
  await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();
  await shot("board");
  await page.goto(`/p/${project.id}/positions/${staff.id}`);
  await expect(page.getByRole("heading", { name: "Staff engineer" })).toBeVisible();
  await shot("position");
  await page.getByRole("tab", { name: "Graph" }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.waitForTimeout(500);
  await shot("graph");
  await page.getByRole("tab", { name: "Timeline" }).click();
  await page.getByRole("button", { name: "Log or plan an action" }).click();
  await page.getByRole("dialog").getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "Offer" }).click();
  await shot("action-dialog");
  await page.keyboard.press("Escape");
  await page.locator("main button.text-left.font-medium").first().click();
  // Phones have no hover; their edit buttons always show.
  if (!phone) await page.getByRole("dialog").getByText("Notes").hover();
  await shot("action-details");
  await page.getByRole("dialog").getByRole("button", { name: "Edit notes" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Ask about the on-call rotation");
  await page.waitForTimeout(900);
  await shot("action-details-saving");
  await page.keyboard.press("Escape");
  await page.goto(`/p/${project.id}`);
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
  await shot("agenda");
  await page.goto(`/p/${project.id}/settings`);
  await shot("settings");
  if (phone) {
    await page.getByRole("button", { name: "More" }).click();
    await shot("more");
    await page.keyboard.press("Escape");
    await page.goto(`/p/${project.id}/positions/${staff.id}`);
    await page.getByRole("tab", { name: "Documents (0)" }).click();
    await shot("position-tabs");
    await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "Assistant" }).click();
    await shot("assistant");
  }
});
