# 0012. Audit log, soft delete, optimistic concurrency

- Status: Accepted
- Date: 2026-10-26
- Source: round-1 Q20

## Context
Projects are shared, so several people (and LLM agents through MCP) may edit the same data.

## Decision
- **Audit log**: `audit_event (project_id, actor_user_id, via, entity_type, entity_id, op, diff jsonb, at)`.
  - `via`: `web` | `api_key` | `mcp`, so changes made by an LLM can be told apart.
  - The audit row is written in the same transaction as the change, from the repository layer.
- **Soft delete**: every domain table gets `deleted_at`. Reads exclude deleted rows by default. Edges pointing to deleted
  actions are hidden too. Restore is supported. Hard delete is reserved for GDPR purges (round-2 Q10).
- **Optimistic concurrency**: every mutable row has an integer `version`. GET returns it as an `ETag`, and
  PATCH/DELETE require `If-Match`. A mismatch returns `412` with the current state.
  - For MCP tools, `version` is a regular body field instead of a header, so LLMs can pass it along.

## Consequences
- The UI must handle a 412 by showing the conflict and offering to reload.
- Audit diffs can grow large, so they will need a retention policy eventually.
