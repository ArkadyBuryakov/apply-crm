# Architecture Decision Records

Each file records one decision: context, the decision itself, and its consequences.
Records are never edited after acceptance except to change status. To revise a decision, add a new record with status `Supersedes NNNN`.

| #    | Title                                                        | Status   |
|------|--------------------------------------------------------------|----------|
| 0001 | [Record architecture decisions](0001-record-architecture-decisions.md) | Accepted |
| 0002 | [Core domain model](0002-core-domain-model.md)               | Accepted |
| 0003 | [Project-scoped data and project defaults](0003-project-scoped-data.md) | Accepted |
| 0004 | [Action model](0004-action-model.md)                         | Accepted, types superseded by 0029 |
| 0005 | [Action graph](0005-action-graph.md)                         | Accepted |
| 0006 | [Documents and resume versioning](0006-documents.md)         | Accepted |
| 0007 | [Authentication and projects via BetterAuth](0007-auth-and-projects.md) | Accepted |
| 0008 | [RBAC](0008-rbac.md)                                         | Accepted |
| 0009 | [API stack and code-first OpenAPI](0009-api-stack.md)        | Accepted |
| 0010 | [MCP server](0010-mcp-server.md)                             | Accepted |
| 0011 | [Deployment and runtime model](0011-deployment.md)           | Accepted |
| 0012 | [Audit log, soft delete, optimistic concurrency](0012-audit-softdelete-concurrency.md) | Accepted |
| 0013 | [Action subjects and participants](0013-action-subjects-and-participants.md) | Accepted |
| 0014 | [Position stages and outcome](0014-position-stages-and-outcome.md) | Accepted |
| 0015 | [Commenter role and comments](0015-commenter-role-and-comments.md) | Accepted, amends 0008 |
| 0016 | [Notifications, search and integrations scope](0016-notifications-and-integrations-scope.md) | Accepted |
| 0017 | [Import/export and personal data deletion](0017-import-export-and-data-deletion.md) | Accepted |
| 0018 | [Composite endpoints and MCP surface](0018-composite-endpoints-and-mcp-surface.md) | Accepted |
| 0019 | [Codebase layout, runtime and frontend stack](0019-codebase-layout-and-stack.md) | Accepted |
| 0020 | [Identifiers and time](0020-identifiers-and-time.md) | Accepted |
| 0021 | [Registration and login](0021-registration-and-login.md) | Accepted |
| 0022 | [Testing strategy](0022-testing-strategy.md) | Accepted |
| 0023 | [v1 scope](0023-v1-scope.md) | Accepted |
| 0024 | [Background worker (pg-boss)](0024-background-worker.md) | Accepted, amends 0011, 0016 |
| 0025 | [LaTeX documents, templates and compilation](0025-latex-documents.md) | Accepted, refines 0006 |
| 0026 | [Position listing content](0026-position-listing-content.md) | Accepted, refines 0002 |
| 0027 | [Hosting on Coolify and backups](0027-hosting-and-backups.md) | Accepted, refines 0011 |
| 0028 | [Repository hygiene and license](0028-repository-hygiene-and-license.md) | Accepted |
| 0029 | [Action type catalogue](0029-action-type-catalogue.md) | Accepted, amends 0004, 0013 |
| 0030 | [Decisions made while implementing v1](0030-v1-implementation-decisions.md) | Accepted, amends 0006, 0007, 0010, 0011, 0012, 0027 |

Open questions live in `docs/questions/`.
