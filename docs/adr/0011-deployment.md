# 0011. Deployment and runtime model

- Status: Accepted, refined by 0027 (Coolify hosting) and amended by 0024 (worker)
- Date: 2026-10-26
- Source: round-1 Q19

## Context
The target is a self-hosted single instance, but the backend must scale horizontally if needed.

## Decision
- **Stateless backend**: any API or MCP replica can serve any request. All state lives in
  - Postgres (data, BetterAuth sessions, audit log, job queue),
  - S3-compatible object storage (documents, 0006).
- **Postgres** with **app-level tenancy filtering** (0003). No RLS.
- **SPA** (Vite, static build) is served **same-origin** by the API server, or by a reverse proxy in front of it.
  Auth uses cookies, and no CORS setup is needed.
- Background work (reminders and future integrations) uses a **Postgres-backed job queue** (e.g. pg-boss or graphile-worker)
  so no extra infrastructure is required. Which jobs exist is open (round-2 Q6).
- Packaging: one container image, plus a `docker-compose` file with Postgres and MinIO for self-hosting.

## Consequences
- No in-process caches that need invalidation, no local file writes, and no in-memory rate limiting. If rate limiting is needed,
  it goes through Postgres (or Redis, added only when needed).
- MCP runs in stateless mode (0010).
