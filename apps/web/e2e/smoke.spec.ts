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

// The assistant sidebar without a provider key (ADR 0031): it opens with Ctrl+J, stays open across navigation and
// reloads, and points to the account page for keys. Talking to a model needs a real key and is not covered here.
test("assistant sidebar opens and asks for a provider key", async ({ page }) => {
  const request = page.request;
  const credentials = { email: "ada@example.test", password: "correct horse battery" };
  // Ada is the user the first test created.
  await request.post("/api/auth/sign-in/email", { data: credentials, headers: { origin: "http://localhost:3100" } });
  const project = await (
    await request.post("/api/projects", { data: { name: "Assistant" }, headers: { origin: "http://localhost:3100" } })
  ).json();

  await page.goto(`/p/${project.id}/agenda`);
  const sidebar = page.getByRole("complementary", { name: "Assistant" });
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
  await expect(sidebar).toBeHidden();
  await page.keyboard.press("Control+j");
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText("To chat, add an API key")).toBeVisible();
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `${process.env.SCREENSHOTS}/assistant-no-key.png` });

  await page.getByRole("link", { name: "Contacts" }).click();
  await expect(sidebar).toBeVisible();
  await page.reload();
  await expect(sidebar).toBeVisible();

  await sidebar.getByRole("button", { name: "Chat history" }).click();
  await expect(sidebar.getByText("No chats yet.")).toBeVisible();
  await sidebar.getByRole("button", { name: "Chat history" }).click();

  await sidebar.getByRole("link", { name: "Add a key in Account → AI" }).click();
  await expect(page.getByText("AI providers")).toBeVisible();
  await expect(page.getByLabel("Anthropic API key")).toBeVisible();
  await expect(page.getByLabel("OpenAI API key")).toBeVisible();
  await expect(page.getByLabel("Google API key")).toBeVisible();

  await page.goto(`/p/${project.id}`);
  await sidebar.getByRole("button", { name: "Close assistant" }).click();
  await expect(sidebar).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();
  await expect(sidebar).toBeHidden();
});

/** A UI message stream (AI SDK SSE protocol) made of the given chunks. */
function uiStream(chunks: object[]) {
  return {
    status: 200,
    headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
    body: `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`,
  };
}

// The model is stubbed at the HTTP boundary; chats, the navigation tool and its round trip are real.
test("assistant navigates the app and continues with the result", async ({ page }) => {
  const request = page.request;
  await request.post("/api/auth/sign-in/email", {
    data: { email: "ada@example.test", password: "correct horse battery" },
    headers: { origin: "http://localhost:3100" },
  });
  const project = await (
    await request.post("/api/projects", { data: { name: "Navigation" }, headers: { origin: "http://localhost:3100" } })
  ).json();

  await page.route("**/api/me/ai/models", (route) =>
    route.fulfill({
      json: {
        items: [{ id: "anthropic:test-model", provider: "anthropic", modelId: "test-model", name: "Test model" }],
        errors: [],
      },
    }),
  );
  const bodies: { message: { parts: { type: string; state?: string; output?: unknown }[] }; page: string }[] = [];
  await page.route("**/chats/*/messages", (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      return route.fulfill(
        uiStream([
          { type: "start", messageId: "msg_1" },
          { type: "start-step" },
          {
            type: "tool-input-available",
            toolCallId: "call_1",
            toolName: "navigate",
            input: { to: "/p/$projectId/contacts" },
          },
          { type: "finish-step" },
          { type: "finish" },
        ]),
      );
    }
    return route.fulfill(
      uiStream([
        { type: "start", messageId: "msg_1" },
        { type: "start-step" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Here are your **contacts**." },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "finish" },
      ]),
    );
  });

  await page.goto(`/p/${project.id}/agenda`);
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
  await page.keyboard.press("Control+j");
  const sidebar = page.getByRole("complementary", { name: "Assistant" });
  await sidebar.getByLabel("Message").fill("Show my contacts");
  await sidebar.getByLabel("Message").press("Enter");

  await expect(page).toHaveURL(new RegExp(`/p/${project.id}/contacts$`));
  await expect(sidebar.getByText("Here are your")).toBeVisible();
  expect(bodies[0]!.page).toContain("/agenda");
  const call = bodies[1]!.message.parts.find((p) => p.type === "tool-navigate");
  expect(call).toMatchObject({ state: "output-available", output: { ok: true } });
  await expect(sidebar.getByText("Show my contacts")).toBeVisible();
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `${process.env.SCREENSHOTS}/assistant-chat.png` });

  // The chat was created on the first message and is remembered for this tab.
  const chatId = await page.evaluate((id) => sessionStorage.getItem(`assistant.chat.${id}`), project.id);
  expect(chatId).toMatch(/^cht_/);
  expect(page.url()).toContain(project.id);
});

test("memory page shows, adds, edits and deletes memories", async ({ page }) => {
  const request = page.request;
  const headers = { origin: "http://localhost:3100" };
  await request.post("/api/auth/sign-in/email", {
    data: { email: "ada@example.test", password: "correct horse battery" },
    headers,
  });
  const project = await (await request.post("/api/projects", { data: { name: "Memory" }, headers })).json();
  // As if an agent had saved it.
  await request.post(`/api/projects/${project.id}/memories`, {
    data: { title: "Goal", content: "Staff role by **March**" },
    headers,
  });

  await page.goto(`/p/${project.id}`);
  await page.getByRole("link", { name: "Memory" }).click();
  await expect(page.getByRole("heading", { name: "Memory", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Goal" })).toBeVisible();
  await expect(page.getByText("March")).toBeVisible();

  const yours = page.locator("div.rounded-lg", { has: page.getByRole("heading", { name: "Your memory" }) });
  await yours.getByRole("button", { name: "Add" }).click();
  const dialog = page.getByRole("dialog", { name: "New memory" });
  await dialog.getByLabel("Title").fill("Languages");
  await dialog.getByLabel("Content").fill("English and German");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(yours.getByText("English and German")).toBeVisible();

  await yours.getByRole("button", { name: "Edit memory" }).click();
  const edit = page.getByRole("dialog", { name: "Edit memory" });
  await edit.getByLabel("Content").fill("English, German and Dutch");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(yours.getByText("English, German and Dutch")).toBeVisible();
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `${process.env.SCREENSHOTS}/memory.png`, fullPage: true });

  // The user's memory is on the account page too.
  await page.goto("/account");
  await expect(page.getByText("English, German and Dutch")).toBeVisible();
  await page.getByRole("button", { name: "Delete memory" }).click();
  await page.getByRole("dialog", { name: "Delete this memory?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("English, German and Dutch")).toBeHidden();
});
