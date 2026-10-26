// Entry point for the BetterAuth CLI (`auth generate`), which needs a module exporting `auth`.
import { createDb } from "@crm/db";
import { createAuth } from "./auth.js";
import { loadEnv } from "./env.js";

const env = loadEnv({
  DATABASE_URL: "postgres://unused",
  BETTER_AUTH_SECRET: "cli-only-secret-cli-only-secret-cli",
  ...process.env,
});
export const auth = createAuth(createDb(env.DATABASE_URL).db, env);
