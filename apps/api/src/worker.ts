// Worker entrypoint (ADR 0024): consumes pg-boss jobs. Same image as the API, different command.
import { rmSync, writeFileSync } from "node:fs";
import { createDb } from "@crm/db";
import { loadEnv } from "./env.js";
import { S3BlobStore } from "./services/blobs.js";
import { runCompileJob, TectonicCompiler } from "./services/compile.js";
import { runAgendaDigest } from "./services/digest.js";
import { type CompileDocumentJob, PgBossJobQueue, QUEUES } from "./services/jobs.js";

// The image's HEALTHCHECK tests for this file; remove a stale one left by a previous run of the same container.
const READY_FILE = "/tmp/worker-ready";
rmSync(READY_FILE, { force: true });

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
// Every 10 minutes; the job itself picks the members whose local time is in the 8 o'clock hour.
await boss.schedule(QUEUES.agendaDigest, "*/10 * * * *");
await boss.work(QUEUES.agendaDigest, async () => {
  const sent = await runAgendaDigest(db);
  if (sent) console.log(`[worker] ${QUEUES.agendaDigest}: ${sent} notifications`);
});
writeFileSync(READY_FILE, "");
console.log("[worker] listening for jobs");

async function shutdown() {
  await boss.stop({ graceful: true, timeout: 30_000 });
  await client.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
