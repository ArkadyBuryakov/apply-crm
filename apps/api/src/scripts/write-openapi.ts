// Writes the OpenAPI document to apps/api/openapi.json for client generation and PR diffs (ADR 0009).
// Needs no running database: nothing is queried while building the document.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb } from "@crm/db";
import { createApi, openApiInfo } from "../app.js";
import { createAuth } from "../auth.js";
import { loadEnv } from "../env.js";
import { MemoryBlobStore } from "../services/blobs.js";
import { MemoryJobQueue } from "../services/jobs.js";

const env = loadEnv({
  DATABASE_URL: "postgres://unused@localhost/unused",
  BETTER_AUTH_SECRET: "openapi-generation-only-secret-000000",
  PUBLIC_URL: process.env.PUBLIC_URL ?? "http://localhost:3000",
});
const { db, client } = createDb(env.DATABASE_URL);
const api = createApi({
  db,
  auth: createAuth(db, env, { offline: true }),
  env,
  services: { blobs: new MemoryBlobStore(), jobs: new MemoryJobQueue() },
});
const doc = api.getOpenAPI31Document(openApiInfo(env.PUBLIC_URL));
const out = fileURLToPath(new URL("../../openapi.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
await client.end();
console.log(`wrote ${out}`);
