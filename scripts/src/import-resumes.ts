// Imports an existing folder-per-position LaTeX resume collection into a project (ADR 0025).
//
//   CRM_API_KEY=crm_… pnpm --filter @crm/scripts import-resumes <dir> --project prj_… [--api http://localhost:3000]
//                     [--main resume_main] [--dry-run]
//
// Layout expected in <dir>: one subfolder per resume, each with one .tex file plus shared files (.cls, .sty, fonts,
// images). The --main folder becomes the main resume and its shared files the template; every other folder becomes a
// company + position named after the folder and a tailored resume derived from the main version. A folder whose shared
// files differ from the main ones gets its own template version. Positions that already exist (same title) are skipped.
// Paths and data stay on your machine; nothing here is committed (ADR 0028).
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const TEMPLATE_EXTENSIONS = new Set([
  ".cls",
  ".sty",
  ".bst",
  ".ttf",
  ".otf",
  ".png",
  ".jpg",
  ".jpeg",
  ".pdf_tex",
  ".eps",
]);
const BUILD_ARTIFACTS = new Set([
  ".aux",
  ".log",
  ".out",
  ".fls",
  ".fdb_latexmk",
  ".synctex.gz",
  ".pdf",
  ".toc",
  ".xdv",
]);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: "string" },
    api: { type: "string", default: "http://localhost:3000" },
    main: { type: "string", default: "resume_main" },
    "dry-run": { type: "boolean", default: false },
  },
});

const dir = positionals[0];
const apiKey = process.env.CRM_API_KEY;
if (!dir || !values.project)
  fail("Usage: import-resumes <dir> --project prj_… [--api URL] [--main FOLDER] [--dry-run]");
if (!apiKey && !values["dry-run"]) fail("Set CRM_API_KEY to a personal API key (Account → API keys)");
const dryRun = values["dry-run"];
const base = `${values.api!.replace(/\/$/, "")}/api/projects/${values.project}`;

type Folder = { name: string; tex: { name: string; source: string }; shared: { name: string; bytes: Buffer }[] };

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(body instanceof FormData ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) fail(`${method} ${url} → ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function readFolder(folderPath: string, name: string): Promise<Folder | null> {
  const entries = await readdir(folderPath);
  const texFiles = entries.filter((e) => e.endsWith(".tex"));
  if (texFiles.length !== 1) {
    console.warn(`skip ${name}: expected exactly one .tex file, found ${texFiles.length}`);
    return null;
  }
  const shared: Folder["shared"] = [];
  for (const entry of entries.sort()) {
    const ext = path.extname(entry).toLowerCase();
    if (BUILD_ARTIFACTS.has(ext) || ext === ".tex") continue;
    if (!TEMPLATE_EXTENSIONS.has(ext)) continue;
    shared.push({ name: entry, bytes: await readFile(path.join(folderPath, entry)) });
  }
  return {
    name,
    tex: { name: texFiles[0]!, source: await readFile(path.join(folderPath, texFiles[0]!), "utf8") },
    shared,
  };
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** Identifies a file set by names and contents, comparable with the server's template version listing. */
const fingerprintOf = (files: { name: string; sha256: string }[]) =>
  sha256(
    [...files]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => `${f.name}:${f.sha256}`)
      .join("\n"),
  );
const fingerprint = (files: Folder["shared"]) =>
  fingerprintOf(files.map((f) => ({ name: f.name, sha256: sha256(f.bytes) })));

function displayName(folder: string) {
  return folder
    .replace(/^resume[_-]?/i, "")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const TEMPLATE_NAME = "Resume class (imported)";
const MAIN_TITLE = "Main resume";

type TemplateVersion = { id: string; versionNo: number; files: { name: string; sha256: string }[] };
type Template = { id: string; versions: TemplateVersion[] };

/** Returns the template version holding exactly these files, uploading a new one only if none does. */
async function uploadTemplateVersion(template: Template, files: Folder["shared"]): Promise<string> {
  const wanted = fingerprint(files);
  const match = template.versions.find((v) => fingerprintOf(v.files) === wanted);
  if (match) return match.id;
  const form = new FormData();
  for (const f of files) form.append("files", new Blob([new Uint8Array(f.bytes)]), f.name);
  const updated = await call<Template>("POST", `${base}/templates/${template.id}/versions`, form);
  template.versions = updated.versions;
  return updated.versions[0]!.id;
}

async function main() {
  const root = path.resolve(dir!);
  const folders: Folder[] = [];
  for (const entry of (await readdir(root)).sort()) {
    const full = path.join(root, entry);
    if (!(await stat(full)).isDirectory()) continue;
    const folder = await readFolder(full, entry);
    if (folder) folders.push(folder);
  }
  const mainFolder = folders.find((f) => f.name === values.main);
  if (!mainFolder) fail(`Main folder "${values.main}" not found in ${root}`);
  const others = folders.filter((f) => f !== mainFolder);

  console.log(
    `main resume: ${mainFolder.name}/${mainFolder.tex.name} with ${mainFolder.shared.map((f) => f.name).join(", ") || "no shared files"}`,
  );
  for (const f of others) {
    const ownTemplate = f.shared.length > 0 && fingerprint(f.shared) !== fingerprint(mainFolder.shared);
    console.log(
      `  ${f.name} → company "${displayName(f.name)}", tailored resume${ownTemplate ? " (own template version)" : ""}`,
    );
  }
  if (dryRun) return console.log("dry run: nothing was changed");

  const existing = await call<{ items: { title: string }[] }>("GET", `${base}/positions?limit=200`);
  // Re-running reuses the imported template and main resume instead of duplicating them.
  const templates = await call<{ items: (Template & { name: string })[] }>("GET", `${base}/templates`);
  const template =
    templates.items.find((t) => t.name === TEMPLATE_NAME) ??
    (await call<Template>("POST", `${base}/templates`, { name: TEMPLATE_NAME }));
  const mainTemplateVersion = mainFolder.shared.length
    ? await uploadTemplateVersion(template, mainFolder.shared)
    : null;

  type Doc = { id: string; title: string; versions: { id: string; sha256: string }[] };
  const mainDocs = await call<{ items: Doc[] }>("GET", `${base}/documents?main=true&kind=resume`);
  const mainDoc =
    mainDocs.items.find((d) => d.title === MAIN_TITLE) ??
    (await call<Doc>("POST", `${base}/documents`, { kind: "resume", title: MAIN_TITLE }));
  const sourceHash = sha256(mainFolder.tex.source);
  const unchanged = mainDoc.versions?.find((v) => v.sha256 === sourceHash);
  const mainVersion =
    unchanged ??
    (await call<{ id: string }>("POST", `${base}/documents/${mainDoc.id}/versions/latex`, {
      source: mainFolder.tex.source,
      templateVersionId: mainTemplateVersion,
      filename: mainFolder.tex.name,
    }));
  console.log(`${unchanged ? "main resume unchanged" : "added main resume version"} (${mainDoc.id})`);

  for (const f of others) {
    const name = displayName(f.name);
    const title = `Position at ${name}`;
    if (existing.items.some((p) => p.title === title)) {
      console.log(`skip ${f.name}: position "${title}" exists`);
      continue;
    }
    const company = await call<{ id: string }>("POST", `${base}/organizations`, { kind: "company", name });
    const position = await call<{ id: string }>("POST", `${base}/positions`, {
      title,
      companyId: company.id,
      notes: `Imported from resume folder ${f.name}. Rename to the actual role.`,
    });
    const templateVersionId =
      f.shared.length && fingerprint(f.shared) !== fingerprint(mainFolder.shared)
        ? await uploadTemplateVersion(template, f.shared)
        : mainTemplateVersion;
    const doc = await call<{ id: string }>("POST", `${base}/documents`, {
      kind: "resume",
      title: `Resume – ${name}`,
      positionId: position.id,
      derivedFromVersionId: mainVersion.id,
    });
    await call("POST", `${base}/documents/${doc.id}/versions/latex`, {
      source: f.tex.source,
      templateVersionId,
      filename: f.tex.name,
    });
    console.log(`imported ${f.name} → ${position.id}`);
  }
}

await main();
