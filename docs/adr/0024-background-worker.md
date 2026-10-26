# 0024. Background worker (pg-boss)

- Status: Accepted (amends 0011 and 0016)
- Date: 2026-10-26
- Source: round-3 Q4

## Context
Server-side LaTeX compilation (ADR 0025) is slow, CPU-heavy and unsafe to run inside an API request. ADR 0016 assumed
v1 needed no job runner. That no longer holds.

## Decision
- Use **pg-boss** as the job queue. It stores jobs in our Postgres, so no new infrastructure is needed.
- Add a **worker process**: the same container image as the API with a different entrypoint (`node dist/worker.js`).
  It scales independently and holds no state (ADR 0011).
- The API only enqueues work. The worker writes results back to Postgres and object storage.
- v1 jobs: `document.compile`. Later candidates: email reminders, integrations (ADR 0016, v2).
- Every job is idempotent and keyed by the entity ID, so a retry or duplicate delivery is harmless.

## Consequences
- Deployment has two services (`api`, `worker`) instead of one (ADR 0027).
- Job state (`queued`/`running`/`ready`/`failed`) is mirrored on the domain entity so that the UI and MCP can show it without
  reading pg-boss tables.
