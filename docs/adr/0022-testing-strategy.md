# 0022. Testing strategy

- Status: Accepted
- Date: 2026-10-26
- Source: round-2 Q19

## Decision
- **Unit tests**: Vitest.
- **Integration tests**: Vitest against a real Postgres (testcontainers). No DB mocks.
- **RBAC matrix**: generated from the OpenAPI spec. Every operation × every role × same-project and cross-project, with the expected
  result derived from `x-permissions` and the role map.
- **MCP contract tests**: a snapshot of the generated tool list per role, plus one round-trip call per exposed tool.
- **e2e**: Playwright smoke tests for the SPA.

## Consequences
- Adding an endpoint automatically adds RBAC tests, so a missing tenancy filter shows up as a failing cross-project case.
