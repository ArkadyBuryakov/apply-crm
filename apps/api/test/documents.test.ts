import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type LatexCompiler, runCompileJob } from "../src/services/compile.js";
import { type Client, createTestApp, ownerWithProject, type TestApp } from "./helpers.js";

let app: TestApp;
let owner: Client;
let p: string;
const base = () => `/api/projects/${p}`;

beforeAll(async () => {
  app = await createTestApp();
  const created = await ownerWithProject(app);
  owner = created.owner;
  p = created.project.id;
});
afterAll(async () => {
  await app.close();
});

/** Pretends to compile: checks the template file is next to the source and writes a PDF. */
const fakeCompiler: LatexCompiler = {
  async compile(dir, mainFile) {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    if (!files.includes("resume.cls")) return { ok: false, log: "resume.cls not found" };
    await writeFile(path.join(dir, mainFile.replace(/\.tex$/, ".pdf")), "%PDF-1.7 fake");
    return { ok: true, log: "Output written" };
  },
};

describe("documents", () => {
  it("versions LaTeX resumes against templates, compiles them and pins versions on actions", async () => {
    const template = await owner.post(`${base()}/templates`, { name: "Resume class" });
    expect(template.status).toBe(201);
    const tv = await owner.upload(`${base()}/templates/${template.body.id}/versions`, "files", [
      { name: "resume.cls", content: "\\ProvidesClass{resume}", type: "text/plain" },
    ]);
    expect(tv.status).toBe(201);
    const templateVersionId = tv.body.versions[0].id;
    expect(templateVersionId).toMatch(/^tv_/);

    const main = await owner.post(`${base()}/documents`, { kind: "resume", title: "Main resume" });
    const v1 = await owner.post(`${base()}/documents/${main.body.id}/versions/latex`, {
      source: "\\documentclass{resume}\\begin{document}Hi\\end{document}",
      templateVersionId,
      filename: "resume.tex",
    });
    expect(v1.status).toBe(201);
    expect(v1.body.compileStatus).toBe("queued");
    expect(app.jobs.compiles).toHaveLength(1);

    const result = await runCompileJob({ db: app.db, blobs: app.blobs, compiler: fakeCompiler }, app.jobs.compiles[0]!);
    expect(result).toBe("ready");
    const compiled = await owner.get(`${base()}/documents/${main.body.id}/versions/${v1.body.id}`);
    expect(compiled.body.compileStatus).toBe("ready");
    expect(compiled.body.hasPdf).toBe(true);
    expect(compiled.body.source).toContain("documentclass");
    const pdf = await owner.raw(`${base()}/documents/${main.body.id}/versions/${v1.body.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(await pdf.text()).toBe("%PDF-1.7 fake");

    // Tailored resume for a position, derived from the main version.
    const pos = (await owner.post(`${base()}/positions`, { title: "Data engineer" })).body;
    const tailored = await owner.post(`${base()}/documents`, {
      kind: "resume",
      title: "Resume – Data engineer",
      positionId: pos.id,
      derivedFromVersionId: v1.body.id,
    });
    expect(tailored.body.derivedFromVersionId).toBe(v1.body.id);
    const tv1 = await owner.post(`${base()}/documents/${tailored.body.id}/versions/latex`, {
      source: "\\documentclass{resume}\\begin{document}Data!\\end{document}",
      templateVersionId,
    });
    expect(tv1.body.filename).toBe("main.tex");

    const applied = await owner.post(`${base()}/actions`, {
      type: "application",
      title: "Applied",
      status: "done",
      payload: { method: "portal" },
      subjects: [{ positionId: pos.id }],
      attachments: [tv1.body.id],
    });
    expect(applied.body.action.attachments).toEqual([tv1.body.id]);

    const overview = await owner.get(`${base()}/positions/${pos.id}/overview`);
    expect(overview.body.documents).toEqual([expect.objectContaining({ id: tailored.body.id, latestVersionNo: 1 })]);
    expect((await owner.get(`${base()}/documents?main=true`)).body.items.map((d: { id: string }) => d.id)).toEqual([
      main.body.id,
    ]);
  });

  it("records compile failures and stores uploads", async () => {
    const doc = await owner.post(`${base()}/documents`, { kind: "other", title: "Broken" });
    const v = await owner.post(`${base()}/documents/${doc.body.id}/versions/latex`, { source: "\\bad" });
    const job = app.jobs.compiles.at(-1)!;
    expect(await runCompileJob({ db: app.db, blobs: app.blobs, compiler: fakeCompiler }, job)).toBe("failed");
    const failed = await owner.get(`${base()}/documents/${doc.body.id}/versions/${v.body.id}`);
    expect(failed.body.compileStatus).toBe("failed");
    expect(failed.body.compileLog).toContain("resume.cls not found");

    const offer = await owner.post(`${base()}/documents`, { kind: "offer", title: "Offer letter" });
    const up = await owner.upload(`${base()}/documents/${offer.body.id}/versions/upload`, "file", [
      { name: "../../offer letter.pdf", content: "%PDF offer", type: "application/pdf" },
    ]);
    expect(up.status).toBe(201);
    expect(up.body.filename).toBe("offer_letter.pdf");
    expect(up.body.hasPdf).toBe(true);
    const file = await owner.raw(`${base()}/documents/${offer.body.id}/versions/${up.body.id}/file`);
    expect(await file.text()).toBe("%PDF offer");
  });
});
