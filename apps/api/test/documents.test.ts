import { writeFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
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

/** A one-page PDF showing `text`, with a correct cross-reference table. */
function minimalPdf(text: string) {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

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

  it("reads the text of uploaded files and LaTeX versions", async () => {
    const doc = await owner.post(`${base()}/documents`, { kind: "resume", title: "Readable" });
    const versions = `${base()}/documents/${doc.body.id}/versions`;
    const upload = async (name: string, content: string | Uint8Array, type: string) => {
      const res = await owner.upload(`${versions}/upload`, "file", [{ name, content, type }]);
      expect(res.status).toBe(201);
      return owner.get(`${versions}/${res.body.id}/text`);
    };

    const notes = await upload("notes.md", "# Experience\nGo & Rust", "text/markdown");
    expect(notes.body).toMatchObject({ format: "text", text: "# Experience\nGo & Rust", truncated: false });

    const pdf = await upload("resume.pdf", minimalPdf("Senior Go engineer"), "application/pdf");
    expect(pdf.body).toMatchObject({ format: "pdf", totalPages: 1 });
    expect(pdf.body.text).toContain("Senior Go engineer");

    const docx = zipSync({
      "word/document.xml": strToU8(
        "<w:document><w:body><w:p><w:r><w:t>Kestrel &amp; Co</w:t></w:r></w:p>" +
          "<w:p><w:r><w:t>Go</w:t><w:tab/><w:t>Kubernetes</w:t></w:r></w:p></w:body></w:document>",
      ),
    });
    const word = await upload(
      "resume.docx",
      docx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(word.body).toMatchObject({ format: "docx", text: "Kestrel & Co\nGo\tKubernetes" });

    const binary = await upload("photo.heic", new Uint8Array([0, 1, 2]), "image/heic");
    expect(binary.status).toBe(409);

    const latex = await owner.post(`${versions}/latex`, { source: "\\documentclass{article}" });
    const source = await owner.get(`${versions}/${latex.body.id}/text`);
    expect(source.body).toMatchObject({ format: "latex", text: "\\documentclass{article}" });
  });

  it("turns .tex uploads into LaTeX versions and picks their template", async () => {
    const template = await owner.post(`${base()}/templates`, { name: "CV class" });
    const tv = await owner.upload(`${base()}/templates/${template.body.id}/versions`, "files", [
      { name: "cv.cls", content: "\\ProvidesClass{cv}", type: "text/plain" },
    ]);
    const templateVersionId = tv.body.versions[0].id;
    const doc = await owner.post(`${base()}/documents`, { kind: "resume", title: "Uploaded resume" });
    const versions = `${base()}/documents/${doc.body.id}/versions`;
    const compiles = app.jobs.compiles.length;

    // The class named in \documentclass picks the template providing cv.cls.
    const uploaded = await owner.upload(`${versions}/upload`, "file", [
      {
        name: "resume.tex",
        content: "% comment\n\\documentclass[11pt]{cv}\n\\begin{document}Hi\\end{document}",
        type: "",
      },
    ]);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body).toMatchObject({ format: "latex", compileStatus: "queued", templateVersionId });
    expect(app.jobs.compiles).toHaveLength(compiles + 1);
    const source = await owner.get(`${versions}/${uploaded.body.id}`);
    expect(source.body.source).toContain("\\documentclass[11pt]{cv}");

    // Later versions keep the document's template, even when their class is not in it; null opts out.
    const next = await owner.post(`${versions}/latex`, { source: "\\documentclass{article}" });
    expect(next.body.templateVersionId).toBe(templateVersionId);
    const plain = await owner.post(`${versions}/latex`, {
      source: "\\documentclass{article}",
      templateVersionId: null,
    });
    expect(plain.body.templateVersionId).toBeNull();

    // A standard class in a new document needs no template.
    const other = await owner.post(`${base()}/documents`, { kind: "other", title: "Letter" });
    const letter = await owner.post(`${base()}/documents/${other.body.id}/versions/latex`, {
      source: "\\documentclass{letter}",
    });
    expect(letter.body.templateVersionId).toBeNull();
  });
});
