# 0030. Decisions made while implementing v1

- Status: Accepted (amends 0006, 0007, 0010, 0011, 0012, 0027)
- Date: 2026-10-26
- Source: implementation of `docs/implementation-plan.md`

## Context

Building v1 surfaced constraints that the earlier records did not anticipate. They are recorded here instead of editing
the accepted records.

## Decision

### Object storage in development: RustFS instead of MinIO (amends 0006, 0011, 0027)

MinIO no longer publishes community container images. Local development and CI use **RustFS**, an S3-compatible server,
in `docker-compose.dev.yml`. Production still uses Hetzner Object Storage. Nothing in the code is specific to either,
because the `BlobStore` S3 implementation talks plain S3.

### MCP authorization details (refines 0010)

- Every project is registered as its own OAuth protected resource (`<PUBLIC_URL>/mcp/projects/<prj_id>`) when it is
  created. Access tokens are audience-bound to that URL, so a token for one project is rejected by every other project's
  endpoint.
- Clients are not linked to individual resources (`enforcePerClientResources: false`). Whether the caller may use a
  project is decided by membership at request time, like everywhere else.
- The MCP endpoint verifies JWT access tokens locally against the instance's JWKS (no HTTP round trip to itself).
  API keys are accepted as `Authorization: Bearer crm_…` or `x-api-key`.
- Discovery is served at the root: `/.well-known/oauth-protected-resource/mcp/projects/<id>` (per project),
  `/.well-known/oauth-authorization-server[/api/auth]` and `/.well-known/openid-configuration[/api/auth]`.
- Dynamic client registration is enabled for public clients. Web clients must use HTTPS redirect URIs.
- The server uses `@modelcontextprotocol/server` 2.x (MCP 2026-07-28) and also serves 2025-era clients statelessly.

### BetterAuth organization routes are not exposed (refines 0007)

BetterAuth's `/api/auth/organization/*` endpoints are blocked at the HTTP layer. Projects, members, invitations and
ownership transfers go through our API only, where single ownership (also enforced by a partial unique index) and the
role rules live. BetterAuth's tables are renamed to `project`, `project_member` and `project_invitation`.

### Link rows are hard-deleted (refines 0012)

Action subjects, participants, edges and attachments are hard-deleted when they change. The audit log records each
link and unlink, so the history is still available. Entities keep soft delete.

### Spec-derived MCP tool inputs

Tool input schemas are built from the OpenAPI document: path and query parameters (minus `projectId`) plus the request
body, flattened into one object when the body is a plain object and nested under `body` otherwise. `$ref`s are inlined
so that every tool schema is self-contained.

### Toolchain constraints

- pnpm's minimum release age policy is kept on. Dependencies are pinned to releases that have passed it, instead of
  being excluded from it.
- TypeScript 7 (native) is used everywhere except `apps/web`, which stays on TypeScript 6 because `openapi-typescript`
  needs the JavaScript compiler API.
- Regex patterns published in the OpenAPI document must not use flags, because OpenAPI cannot express them. Public IDs
  are therefore matched in upper case only, which is how the API always emits them.

## Consequences

- Self-hosters who want local object storage can run RustFS (commented out in `docker-compose.yml`) or any other
  S3-compatible server.
- Changing the instance's `PUBLIC_URL` changes every project's MCP resource identifier. Existing MCP tokens stop
  working, and the `oauth_resource` rows must be updated to the new URLs.
