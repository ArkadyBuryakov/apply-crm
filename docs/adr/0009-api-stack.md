# 0009. API stack and code-first OpenAPI

- Status: Accepted
- Date: 2026-10-26
- Source: round-1 Q14, Q15

## Context
The OpenAPI spec must be generated from code, and the MCP tool descriptions must be generated from the spec.

## Decision
- **Hono** + **@hono/zod-openapi** + **Drizzle ORM** on Postgres, written in TypeScript.
- Zod schemas are the single source for request/response validation, OpenAPI components and TS types.
- Routes are defined with a project-local wrapper around `createRoute` that requires:
  - `operationId`, `summary` and `description`, because these become MCP tool text, so they are written for an LLM reader;
  - `permissions` (emitted as `x-permissions` and enforced at runtime by the same wrapper);
  - an optional `mcp` field (emitted as `x-mcp`: `{ expose, name?, description? }`).
- The spec is served at `/api/openapi.json` and also written to a file at build time so it can be diffed in PRs.
- Resource-oriented REST under `/api/projects/{projectId}/…`. Graph operations and the reschedule are explicit
  sub-resources and actions (`/actions/{id}/edges`, `/actions/{id}:reschedule`).

## Consequences
- A route without permissions does not compile, so an unguarded endpoint can't be forgotten.
- Quality of the spec text directly affects MCP usability, so reviews must check it.
- The frontend API client approach is open (round-2 Q13).
