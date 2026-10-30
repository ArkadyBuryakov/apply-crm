// Background jobs on pg-boss (ADR 0024). The API only enqueues; the worker process consumes.
import { PgBoss } from "pg-boss";

export const QUEUES = {
  compileDocument: "document.compile",
  agendaDigest: "agenda.digest",
} as const;

export type CompileDocumentJob = { projectId: string; documentVersionId: string };

export interface JobQueue {
  enqueueCompile(job: CompileDocumentJob): Promise<void>;
}

export class PgBossJobQueue implements JobQueue {
  constructor(private readonly boss: PgBoss) {}

  static async start(databaseUrl: string) {
    const boss = new PgBoss({ connectionString: databaseUrl, schema: "pgboss" });
    boss.on("error", (err) => console.error("[pg-boss]", err));
    await boss.start();
    await boss.createQueue(QUEUES.compileDocument);
    await boss.createQueue(QUEUES.agendaDigest);
    return { queue: new PgBossJobQueue(boss), boss };
  }

  async enqueueCompile(job: CompileDocumentJob) {
    // singletonKey makes duplicate enqueues for the same version harmless (jobs are idempotent).
    await this.boss.send(QUEUES.compileDocument, job, {
      singletonKey: job.documentVersionId,
      retryLimit: 2,
      expireInSeconds: 300,
    });
  }
}

/** Records jobs instead of running them; used in tests. */
export class MemoryJobQueue implements JobQueue {
  readonly compiles: CompileDocumentJob[] = [];

  async enqueueCompile(job: CompileDocumentJob) {
    this.compiles.push(job);
  }
}
