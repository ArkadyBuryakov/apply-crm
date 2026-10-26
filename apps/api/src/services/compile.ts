// LaTeX compilation in the worker (ADR 0024, 0025): sandboxed Tectonic, one temp directory per job, hard timeout.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Db, documentTemplateVersion, documentVersion } from "@crm/db";
import { and, eq } from "drizzle-orm";
import { type BlobStore, blobKeys } from "./blobs.js";
import type { CompileDocumentJob } from "./jobs.js";

const MAX_LOG_CHARS = 20_000;

export interface LatexCompiler {
  /** Compiles `mainFile` inside `dir`; the PDF is expected next to it. */
  compile(dir: string, mainFile: string): Promise<{ ok: boolean; log: string }>;
}

export class TectonicCompiler implements LatexCompiler {
  constructor(private readonly options: { binary?: string; timeoutMs?: number; onlyCached?: boolean } = {}) {}

  compile(dir: string, mainFile: string): Promise<{ ok: boolean; log: string }> {
    // --untrusted disables shell escape and other features that could run code from the document.
    const args = ["-X", "compile", "--untrusted", "--outdir", dir];
    if (this.options.onlyCached) args.push("--only-cached");
    args.push(mainFile);
    return new Promise((resolve) => {
      const child = spawn(this.options.binary ?? "tectonic", args, {
        cwd: dir,
        // Minimal environment: no credentials from the worker's environment reach the compiler.
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: dir,
          ...(process.env.TECTONIC_CACHE_DIR ? { TECTONIC_CACHE_DIR: process.env.TECTONIC_CACHE_DIR } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let log = "";
      const append = (chunk: Buffer) => {
        if (log.length < MAX_LOG_CHARS * 2) log += chunk.toString();
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      const timer = setTimeout(() => {
        log += "\n[compile timed out]";
        child.kill("SIGKILL");
      }, this.options.timeoutMs ?? 60_000);
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ ok: false, log: `${log}\n[failed to start tectonic: ${err.message}]` });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, log });
      });
    });
  }
}

function truncateLog(log: string) {
  return log.length > MAX_LOG_CHARS ? `…${log.slice(-MAX_LOG_CHARS)}` : log;
}

/** Runs one compile job. Idempotent: re-running overwrites the PDF and status of the same version. */
export async function runCompileJob(
  deps: { db: Db; blobs: BlobStore; compiler: LatexCompiler },
  job: CompileDocumentJob,
): Promise<"ready" | "failed" | "skipped"> {
  const { db, blobs, compiler } = deps;
  const [version] = await db
    .select()
    .from(documentVersion)
    .where(and(eq(documentVersion.projectId, job.projectId), eq(documentVersion.id, job.documentVersionId)));
  if (!version || version.source === null) return "skipped";

  await db.update(documentVersion).set({ compileStatus: "running" }).where(eq(documentVersion.id, version.id));
  const dir = await mkdtemp(path.join(tmpdir(), "crm-compile-"));
  try {
    if (version.templateVersionId) {
      const [template] = await db
        .select()
        .from(documentTemplateVersion)
        .where(eq(documentTemplateVersion.id, version.templateVersionId));
      for (const file of template?.files ?? []) {
        const bytes = await blobs.get(file.blobKey);
        if (!bytes) throw new Error(`Template file ${file.name} is missing from storage`);
        await writeFile(path.join(dir, path.basename(file.name)), bytes);
      }
    }
    const mainFile = path.basename(version.filename);
    await writeFile(path.join(dir, mainFile), version.source);

    const result = await compiler.compile(dir, mainFile);
    const pdfPath = path.join(dir, mainFile.replace(/\.tex$/, ".pdf"));
    const pdf = result.ok ? await readFile(pdfPath).catch(() => null) : null;
    if (pdf) {
      const key = blobKeys.pdf(job.projectId, version.id);
      await blobs.put(key, new Uint8Array(pdf), "application/pdf");
      await db
        .update(documentVersion)
        .set({ compileStatus: "ready", pdfBlobKey: key, compileLog: truncateLog(result.log), compiledAt: new Date() })
        .where(eq(documentVersion.id, version.id));
      return "ready";
    }
    await db
      .update(documentVersion)
      .set({
        compileStatus: "failed",
        compileLog: truncateLog(result.log || "No PDF was produced"),
        compiledAt: new Date(),
      })
      .where(eq(documentVersion.id, version.id));
    return "failed";
  } catch (err) {
    await db
      .update(documentVersion)
      .set({ compileStatus: "failed", compileLog: String(err), compiledAt: new Date() })
      .where(eq(documentVersion.id, version.id));
    return "failed";
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
