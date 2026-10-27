# Implementation plan — v1

Builds the v1 scope from ADR 0023, following `docs/architecture.md`. Each phase ends in a verifiable state: typecheck,
tests and a running app. Later phases depend only on earlier ones.

## Phase 0 — Scaffold

**Status: done.**

- pnpm workspace: `apps/api`, `apps/web`, `packages/shared`, `packages/db`, `scripts/`
- TypeScript strict and Biome (lint + format). Internal packages export TS source, which tsx, Vite and tsup consume directly.
- `docker-compose.dev.yml`: Postgres 18 and RustFS (S3; MinIO no longer publishes images, see ADR 0030)
- `.gitignore` per ADR 0028, a gitleaks pre-commit hook (`lefthook`), `.env.example`, and `"license": "AGPL-3.0-only"` everywhere
- **Done when:** `pnpm install && pnpm typecheck && pnpm lint` pass on an empty skeleton.

## Phase 1 — Data layer (`packages/db`, `packages/shared`)

**Status: done.**

- Drizzle schema for every domain table (ADRs 0002–0006, 0012–0015, 0025): `project_id` on every row, composite FKs
  `(project_id, id)` for same-project references, `version` and `deleted_at` columns, UUIDv7 keys
- Migrations through drizzle-kit, plus project seeding from `config/project-defaults.json` (channels, stages)
- `shared`: prefixed-ID codec (0020), enums, action payload union (0029), permission map (0008/0015)
- **Done when:** migrations apply to a clean DB, and unit tests for the ID codec and payload schemas pass.

## Phase 2 — Auth and projects (`apps/api`)

**Status: done.**

- BetterAuth: email + password, optional Google/GitHub, organization plugin (= project), API-key plugin, MCP/OAuth provider plugin
- Hooks: first user becomes instance admin, then sign-up is invite-only (0021); single owner plus `transferOwnership` (0007)
- Project creation seeds defaults (0003)
- **Done when:** integration tests cover sign-up, login, creating a project, inviting and accepting, and ownership transfer.

## Phase 3 — Core API

**Status: done.**

- A `defineRoute` wrapper around `createRoute`: requires `operationId`/`summary`/`description`/`permissions`, emits
  `x-permissions`/`x-mcp`, and enforces the permission at runtime (0009)
- A project-scoped repository context: tenancy filter, audit event in the same transaction, soft delete, optimistic
  concurrency (`ETag`/`If-Match`, or a `version` body field) (0003, 0012)
- Resources: projects/members, channels, stages, organizations, contacts (affiliations, handles), positions,
  actions (subjects, participants, reschedule), edges (cycle warning, cycle-safe traversal), comments, notifications
- Composite operations: `getPositionOverview`, `getAgenda`, `logInteraction` (0018); search (0016); export/import (0017); contact purge
- **Done when:** `/api/openapi.json` validates, the integration tests pass, and the generated RBAC matrix (0022) passes.

## Phase 4 — MCP server

**Status: done.** Includes the full OAuth flow test (registration → consent → token → MCP call).

- `/mcp/projects/:projectId`: stateless Streamable HTTP. Tools are generated from the spec (`x-mcp.expose`) and filtered by the caller's role.
  Calls go through `app.request()` as the caller (0010).
- Auth: OAuth 2.1 bearer tokens (BetterAuth provider, discovery metadata, dynamic client registration) or API keys
- **Done when:** MCP contract tests pass: a tool-list snapshot per role and a round-trip call per tool.

## Phase 5 — Documents and worker

**Status: done.** Compilation verified in the worker image with Tectonic 0.17, including a shell-escape check.

- A `BlobStore` interface with an S3 implementation (RustFS in development, Hetzner in production)
- Templates and template versions, documents and versions (LaTeX source or binary), attachments on actions (0006, 0025)
- pg-boss `document.compile` job, a worker entrypoint, Tectonic compilation in a sandbox with a time limit (0024)
- `scripts/import-resumes <dir>` using the public API with an API key
- **Done when:** integration tests cover upload/download and the compile job. Tectonic itself is exercised in the worker image.

## Phase 6 — Web SPA (`apps/web`)

**Status: done.**

- React, TanStack Router + Query, shadcn/ui (Tailwind), `openapi-fetch` generated from the spec
- Screens: auth, project switcher and settings (members, invites, API keys, stages, channels), positions board (kanban by stage),
  position detail (overview, timeline, documents, comments), organizations, contacts, agenda, the action graph (React Flow), search
- Permission-gated UI from `GET /api/projects/:id/me`
- **Done when:** a Playwright smoke test passes (sign up → create project → add position → log action → see graph).

## Phase 7 — Packaging

**Status: done.** CI runs on GitHub Actions; it has not run yet because nothing is pushed.

- A multi-stage Dockerfile: `api` (slim) and `worker` (with Tectonic and its bundle) targets
- `docker-compose.yml` for self-hosting, plus deploy docs (Coolify, backups, restore drill)
- CI workflow: typecheck, lint, tests, gitleaks, license check
- **Done when:** `docker compose up` brings up a working instance.
