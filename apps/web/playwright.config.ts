import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// Use a system Chromium when present (no browser download needed); CI installs Playwright's own.
const systemChromium = ["/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => existsSync(p));

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    ...(systemChromium && !process.env.CI ? { launchOptions: { executablePath: systemChromium } } : {}),
  },
  webServer: {
    command: "pnpm --filter @crm/api exec tsx src/scripts/e2e-server.ts",
    url: `http://localhost:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      PUBLIC_URL: `http://localhost:${PORT}`,
      BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-000",
      WEB_DIST_DIR: new URL("./dist", import.meta.url).pathname,
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:9000",
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "devaccess",
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "devsecret-devsecret",
      S3_BUCKET: "crm-e2e",
      S3_FORCE_PATH_STYLE: "true",
    },
  },
});
