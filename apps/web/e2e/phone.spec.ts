import { expect, type Page, test } from "@playwright/test";

// The phone layout (ADR 0035), run by the "phone" project after the desktop smoke test has created the first user.
const h = { origin: "http://localhost:3100" };

async function setUp(page: Page) {
  const request = page.request;
  const user = { email: "ada@example.test", password: "correct horse battery" };
  if (!(await request.post("/api/auth/sign-in/email", { data: user, headers: h })).ok())
    await request.post("/api/auth/sign-up/email", { data: { ...user, name: "Ada" }, headers: h });
  const post = async (path: string, data: unknown) => (await request.post(path, { data, headers: h })).json();
  const project = await post("/api/projects", { name: "Phone search" });
  const p = `/api/projects/${project.id}`;
  const stages = (await (await request.get(`${p}/stages`)).json()).items as { id: string; key: string }[];
  const stage = (key: string) => stages.find((s) => s.key === key)!.id;
  const acme = await post(`${p}/organizations`, { kind: "company", name: "Acme Robotics" });
  await post(`${p}/contacts`, { name: "Dana Recruiter" });
  const position = await post(`${p}/positions`, {
    title: "Staff engineer",
    companyId: acme.id,
    stageId: stage("applied"),
  });
  await post(`${p}/actions`, {
    type: "task",
    title: "Check with the hiring manager on feedback about the take-home and the second interview round",
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    payload: { priority: "high" },
    subjects: [{ positionId: position.id }],
  });
  return { projectId: project.id as string, positionId: position.id as string };
}

test("tab bar, stage chips and sheets replace the sidebar and board", async ({ page }) => {
  const { projectId, positionId } = await setUp(page);
  await page.goto(`/p/${projectId}/pipeline`);

  const tabs = page.getByRole("navigation", { name: "Tabs" });
  await expect(tabs).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Project navigation" })).toBeHidden();

  // The stage with positions is picked first; its card moves with the stage picker instead of drag-and-drop.
  await expect(page.getByRole("tab", { name: /Applied/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("combobox", { name: "Stage of Staff engineer" }).click();
  await page.getByRole("option", { name: "Screening" }).click();
  await expect(page.getByText("Nothing at this stage.")).toBeVisible();
  await page.getByRole("tab", { name: /Screening/ }).click();
  await expect(page.getByRole("link", { name: /Staff engineer/ })).toBeVisible();
  await expect(page).toHaveURL(/[?&]stage=screening/);

  // Dialogs fill the screen.
  await page.getByRole("button", { name: "New position" }).click();
  const dialog = page.getByRole("dialog", { name: "New position" });
  const viewport = page.viewportSize()!;
  expect(await dialog.boundingBox()).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  await page.keyboard.press("Escape");

  // Detail pages go back to their list from the header.
  await page.getByRole("link", { name: /Staff engineer/ }).click();
  await expect(page.getByRole("heading", { name: "Staff engineer" })).toBeVisible();
  await page.getByRole("button", { name: "Pipeline" }).click();
  // Back on the stage that was picked.
  await expect(page).toHaveURL(new RegExp(`/p/${projectId}/pipeline\\?stage=screening$`));
  await expect(page.getByRole("tab", { name: /Screening/ })).toHaveAttribute("aria-selected", "true");

  // More holds the rest of the sidebar.
  await tabs.getByRole("button", { name: "More" }).click();
  await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Contacts" }).click();
  await expect(page.getByRole("dialog", { name: "More" })).toBeHidden();
  await expect(page.getByRole("link", { name: /Dana Recruiter/ })).toBeVisible();

  // Search has its own field, as the header has none.
  await tabs.getByRole("link", { name: "Search" }).click();
  await page.getByRole("searchbox", { name: "Search" }).fill("Acme");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Results for “Acme”" })).toBeVisible();

  // Long action titles are cut off instead of widening the page.
  await tabs.getByRole("link", { name: "Agenda" }).click();
  await expect(page.getByRole("button", { name: /Check with the hiring manager/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);

  // The assistant leaves the tab bar in place, and going back or to another tab closes it.
  await tabs.getByRole("button", { name: "Assistant" }).click();
  const assistant = page.getByRole("complementary", { name: "Assistant" });
  await expect(assistant.getByRole("button", { name: "Go back" })).toBeVisible();
  await expect(tabs).toBeVisible();
  await tabs.getByRole("link", { name: "Pipeline" }).click();
  await expect(assistant).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/p/${projectId}/pipeline$`));
  await tabs.getByRole("button", { name: "Assistant" }).click();
  await assistant.getByRole("button", { name: "Go back" }).click();
  await expect(assistant).toBeHidden();

  // The position's main action floats above the tab bar.
  await page.goto(`/p/${projectId}/positions/${positionId}`);
  await expect(page.getByRole("button", { name: /Check with the hiring manager/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
  await page.getByRole("button", { name: "Log or plan an action" }).click();
  await expect(page.getByRole("dialog", { name: "Log or plan an action" })).toBeVisible();
});

test("can be installed to the home screen", async ({ page }) => {
  await page.goto("/login");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await page.request.get(href!)).json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/" });
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
  expect((await page.request.get("/apple-touch-icon.png")).ok()).toBe(true);
});
