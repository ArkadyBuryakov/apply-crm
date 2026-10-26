# 0004. Action model

- Status: Accepted, type list superseded by 0029
- Date: 2026-10-26
- Source: round-1 Q8, Q9

## Context
An action covers both planned activities and finished ones. Each type needs its own fields, and the
MCP tools need precise schemas.

## Decision

### Types
A closed enum, in which each type has its own payload:

`email`, `call`, `meeting`, `interview`, `application`, `take_home`, `offer`, `task`, `note`

Storage: one `action` table with the common columns plus a `payload jsonb` column validated by Zod. In the API, the payload is a
discriminated union on `type`, which becomes OpenAPI `oneOf` with a discriminator.

Common columns: `id`, `project_id`, `type`, `status`, `title`, `scheduled_at?`, `completed_at?`, `due_at?`,
`channel_id?`, the anchors (round-2 Q1), audit/version columns (0012).

### Statuses
`planned` → `done` | `cancelled` | `no_show` | `rescheduled`

- **Reschedule** does not move the record. The original gets status `rescheduled`, and a **new** `planned` action is
  created and linked to it with a `rescheduled` edge (0005). The history of attempts therefore stays visible in the graph.
- A `task` uses the same statuses (`planned` means open). `no_show` doesn't apply to tasks; validation is per type.

## Consequences
- Adding a type requires a code change and a migration of the Zod union. User-defined types are out of scope.
- The `reschedule` endpoint is atomic: it updates the old action, creates the new one and adds the edge in one transaction.
- Payload fields can't be indexed directly. If filtering by payload fields becomes necessary, add generated columns or a
  per-type table later.
