// Worker entrypoint (ADR 0024): consumes pg-boss jobs. Same image as the API, different command.
import { createDb } from "@crm/db";
import { loadEnv } from "./env.js";
import { S3BlobStore } from "./services/blobs.js";
import { runCompileJob, TectonicCompiler } from "./services/compile.js";
import { type CompileDocumentJob, PgBossJobQueue, QUEUES } from "./services/jobs.js";

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL, { max: 4 });
const blobs = S3BlobStore.fromEnv(env);
const compiler = new TectonicCompiler({
  binary: process.env.TECTONIC_BIN,
  timeoutMs: Number(process.env.COMPILE_TIMEOUT_MS ?? 60_000),
  onlyCached: process.env.TECTONIC_ONLY_CACHED === "true",
});

const { boss } = await PgBossJobQueue.start(env.DATABASE_URL);
await boss.work<CompileDocumentJob>(QUEUES.compileDocument, { batchSize: 1 }, async ([job]) => {
  if (!job) return;
  const result = await runCompileJob({ db, blobs, compiler }, job.data);
  console.log(`[worker] ${QUEUES.compileDocument} ${job.data.documentVersionId}: ${result}`);
});
console.log("[worker] listening for jobs");

async function shutdown() {
  await boss.stop({ graceful: true, timeout: 30_000 });
  await client.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
