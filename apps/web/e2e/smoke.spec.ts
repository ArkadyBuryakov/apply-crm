import { expect, test } from "@playwright/test";

// The plan's smoke path (Phase 6): sign up → create project → add position → log action → see it in the graph.
test("first user sets up a project and logs an interaction", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("link", { name: "Create your account" }).click();
  await expect(page.getByText("Set up this instance")).toBeVisible();
  await page.getByLabel("Name").fill("Ada");
  await page.getByLabel("Email").fill("ada@example.test");
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: "Your projects" })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name").fill("Job search");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();

  await page.getByRole("button", { name: "New position" }).click();
  await page.getByLabel("Title").fill("Staff engineer");
  await page.getByRole("button", { name: "New" }).first().click();
  const orgDialog = page.getByRole("dialog", { name: "New organization" });
  await orgDialog.getByLabel("Name").fill("Acme");
  await orgDialog.getByRole("button", { name: "Save" }).click();
  await expect(orgDialog).toBeHidden();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("heading", { name: "Staff engineer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Acme" })).toBeVisible();

  await page.getByRole("button", { name: "Log or plan an action" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Type").selectOption("application");
  await dialog.getByLabel("Status").selectOption("done");
  await dialog.getByLabel("Title").fill("Applied on careers site");
  await dialog.getByRole("button", { name: "Save" }).click();

  // Logging a done application suggests moving the position to "Applied".
  await expect(page.getByText("Move position to “Applied”?")).toBeVisible();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByLabel("Stage")).toHaveValue(/.+/);
  await expect(page.getByText("Applied on careers site")).toBeVisible();

  await page.getByRole("tab", { name: "Graph" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByLabel("MCP URL")).toHaveValue(/\/mcp\/projects\/prj_/);
});
