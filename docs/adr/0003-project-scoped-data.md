# 0003. Project-scoped data and project defaults

- Status: Accepted
- Date: 2026-10-26
- Source: round-1 Q3, Q19

## Context
A user may belong to several projects. Shared global rows (one "Acme Corp" for everybody) would leak data between
tenants and make RBAC harder.

## Decision
- Every domain row (Organization, Position, Contact, Channel, Action, Document, …) has a non-null `project_id`.
  Nothing is shared across projects.
- Tenancy is enforced **at the application level**, not with Postgres RLS. All data access goes through a repository
  layer that requires a `projectId` and adds it to every query.
- New projects are seeded from a **project defaults config** that ships with the deployment and covers channels,
  pipeline stages and any other lookup values. Seeding copies rows into the project, so later edits don't affect existing projects.

## Consequences
- Duplicates across projects are expected and acceptable.
- Every cross-entity reference (an FK, or an edge in the action graph) must be validated as same-project.
  Composite FKs `(project_id, id)` let the database enforce this where practical.
- Without RLS, a missing filter is a data leak. Tests must cover cross-project access on every endpoint (see the RBAC test matrix in 0008).
