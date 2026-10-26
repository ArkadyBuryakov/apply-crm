import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/auth-schema.ts", "./src/schema.ts"],
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://crm:crm@localhost:5433/crm" },
});
