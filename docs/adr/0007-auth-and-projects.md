# 0007. Authentication and projects via BetterAuth

- Status: Accepted, HTTP exposure refined by 0030
- Date: 2026-10-26
- Source: round-1 Q11, Q17

## Context
The app needs authentication, a Project scope entity with exactly one owner, optional members, and invitations.

## Decision
- Use **BetterAuth** for authentication, with the session stored in Postgres via the Drizzle adapter.
- **Project = a BetterAuth organization** (organization plugin). Membership, invitations and the role
  per member come from the plugin.
- **Single owner** is enforced in our code, because the plugin allows several:
  - exactly one member with role `owner` per project, checked in a transaction and backed by a partial unique index;
  - an explicit `transferOwnership` endpoint, after which the previous owner becomes `editor`;
  - the owner cannot leave or be removed until ownership has been transferred.
- **API keys** (BetterAuth API key plugin) cover scripts and non-OAuth MCP clients.
- **OAuth 2.1 provider** capability (BetterAuth MCP/OIDC provider plugin) covers remote MCP clients (0010).

## Consequences
- The organization plugin's terminology ("organization") is wrapped as "project" in our API and UI.
- Plugin upgrades may change the schema, so the version is pinned and migrations are reviewed.
- What happens to a project when its owner deletes their account is open (round-2 Q10).
