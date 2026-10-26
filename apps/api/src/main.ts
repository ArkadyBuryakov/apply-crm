// API server entrypoint: REST + auth + MCP, and the SPA build when WEB_DIST_DIR is set (ADR 0011).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createDb, runMigrations } from "@crm/db";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { secureHeaders } from "hono/secure-headers";
import { createApi } from "./app.js";
import { createAuth } from "./auth.js";
import { loadEnv } from "./env.js";
import { S3BlobStore } from "./services/blobs.js";
import { PgBossJobQueue } from "./services/jobs.js";

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL);
if (process.env.MIGRATE_ON_START !== "false") await runMigrations(db);

const blobs = S3BlobStore.fromEnv(env);
if (env.NODE_ENV !== "production") await blobs.ensureBucket();
const { queue, boss } = await PgBossJobQueue.start(env.DATABASE_URL);

const auth = createAuth(db, env);
const api = createApi({ db, auth, env, services: { blobs, jobs: queue } });

const webDist = env.WEB_DIST_DIR ? path.resolve(env.WEB_DIST_DIR) : null;
if (webDist && existsSync(path.join(webDist, "index.html"))) {
  const indexHtml = readFileSync(path.join(webDist, "index.html"), "utf8");
  api.use("/assets/*", secureHeaders(), serveStatic({ root: path.relative(process.cwd(), webDist) }));
  // Client-side routes fall back to index.html; API, MCP and discovery paths never do.
  api.get("*", secureHeaders(), async (c, next) => {
    if (/^\/(api|mcp|\.well-known)(\/|$)/.test(c.req.path)) return next();
    const file = serveStatic({ root: path.relative(process.cwd(), webDist) });
    const served = await file(c, async () => {});
    return served ?? c.html(indexHtml);
  });
}

const server = serve({ fetch: api.fetch, port: env.PORT }, (info) => {
  console.log(`[api] listening on :${info.port} (${env.PUBLIC_URL})`);
});

async function shutdown() {
  server.close();
  await boss.stop({ graceful: true, timeout: 10_000 });
  await client.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
