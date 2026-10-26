# 0006. Documents and resume versioning

- Status: Accepted, refined by 0025 (LaTeX documents and templates) and 0030 (RustFS in development)
- Date: 2026-10-26
- Source: round-1 Q10, Q19

## Context
The app must keep CVs, cover letters, take-home submissions, offers and other files. Two things matter specifically:
the user's main resume evolves over time, and tailored resumes are made for specific positions.
It must always be possible to tell exactly which file was sent with an application.

## Decision
- `Document (project_id, kind, title, position_id?, derived_from_version_id?)`
  - `kind`: `resume`, `cover_letter`, `take_home`, `offer`, `other`
  - **Main resume**: a `resume` document with no `position_id`.
  - **Tailored resume**: a `resume` document with `position_id` set and `derived_from_version_id` pointing at
    the main resume version it was based on.
- `DocumentVersion (document_id, version_no, storage_key, filename, mime, size, sha256, created_by, created_at)`
  is immutable. A new upload creates a new version.
- Actions reference **versions**, not documents: `action_attachment (action_id, document_version_id)`. Sending a CV
  pins the exact version.
- Blob storage sits behind a `BlobStore` interface. Production uses S3-compatible storage (MinIO for self-hosting).
  Local disk is allowed only in development (0011: the backend is stateless).

## Consequences
- Versions are never deleted while an action references them. Soft delete hides the document (0012).
- Uploads and downloads go through the API (or presigned URLs) and are RBAC-checked like any other resource.
- Whether the MCP server exposes document text to LLMs is open (round-2 Q11).
