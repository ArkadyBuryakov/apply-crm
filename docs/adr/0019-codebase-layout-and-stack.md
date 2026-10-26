# 0019. Codebase layout, runtime and frontend stack

- Status: Accepted
- Date: 2026-10-26
- Source: round-2 Q14, Q15, Q16

## Decision

### Layout: pnpm workspaces
```
apps/api        Hono API + MCP endpoint (/mcp/...) + serves the SPA build
apps/web        Vite SPA
packages/shared Zod schemas, permissions, enums
packages/db     Drizzle schema + migrations
```
MCP runs inside `apps/api`. Because it is stateless (ADR 0010), it can be split into its own app later without design changes.

### Runtime
Node LTS in production, `tsx` in development.

### Frontend
- React + TanStack Router + TanStack Query
- shadcn/ui (Tailwind)
- API client: `openapi-typescript` + `openapi-fetch`, generated from the same spec that MCP uses, so the frontend
  consumes the public contract rather than private Hono RPC types
- Action graph visualization: React Flow

## Consequences
- The spec build step must run before the frontend typecheck (a turbo/pnpm pipeline dependency).
