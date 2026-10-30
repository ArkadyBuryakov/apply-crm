# 0025. LaTeX documents, templates and compilation

- Status: Accepted (refines 0006)
- Date: 2026-10-26
- Source: round-3 Q3–Q5

## Context
Resumes are LaTeX: a per-position `.tex` file plus a shared class file (`.cls`). Keeping the source as text lets an
LLM read and edit it through MCP. Copying the class file into every tailored version leads to drift.

## Decision

### Templates
- `DocumentTemplate (project_id, name)` with versions `DocumentTemplateVersion (template_id, version_no, files[])`, where
  `files` are blobs such as `.cls`, fonts and images.
- A document version **pins a template version**, so recompiling an old version always produces the same PDF. This
  holds after the template is soft-deleted: it stops being offered and inferred, but its pinned versions keep compiling.

### Document versions (extends ADR 0006)
- A LaTeX document version holds:
  - `source` (the `.tex` text, stored in Postgres so it can be searched and returned directly by MCP),
  - `template_version_id`,
  - `pdf_blob_key?` and `compile_status` (`queued` | `running` | `ready` | `failed`) plus `compile_log?`.
- Creating a version enqueues `document.compile` (ADR 0024). Non-LaTeX documents (offer PDFs, take-home zips) remain
  plain blob versions as described in ADR 0006.
- MCP tools: read a version's source, and create a new version from source text (tailoring = read main → write tailored).

### Compilation (worker)
- **Tectonic** inside the worker image, with its package bundle cached at build time so compiling needs no network.
- Sandbox: shell-escape disabled (`\write18` is off; Tectonic doesn't support it), a fresh temp directory per job, a wall-clock
  timeout, memory and CPU limits, and no access outside the job directory.
- Output: the PDF is stored in object storage, and the log is stored truncated.

### Import of existing resumes
A CLI script (`scripts/import-resumes`) takes a directory path **as an argument** and uses the public API with an API key.
Each subfolder becomes a position (named from the folder) plus a tailored resume version derived from the main resume.
The `.cls` file becomes the template. Real paths and data are never committed (ADR 0028).

### Amendment (2026-10-28): uploads and template choice
- Uploading a `.tex` file creates a LaTeX version (source in Postgres, compiled), never a plain file version, so an
  uploaded resume gets the same compile and PDF preview as one written in the editor.
- When no template version is given, the latest version of the template the document's newest LaTeX version used is
  pinned; for a document without one, the template whose latest version provides the class named in
  `\documentclass`. An explicit `null` compiles without a template.
- A local worker without `TECTONIC_CACHE_DIR` caches Tectonic's bundle in the user's cache directory, since `HOME` is
  the per-job temp directory.

## Consequences
- The worker image is larger (Tectonic plus its bundle, roughly hundreds of MB). The API image can stay slim if the two are split later.
- A template file must work with Tectonic's XeTeX-based engine. Class files that rely on pdfLaTeX-only packages may need adjustment.
