# 0010. MCP server

- Status: Accepted
- Date: 2026-10-26
- Source: round-1 Q15–Q18

## Context
LLM clients must be able to work with the CRM. The tool list must reflect the user's RBAC permissions, and tool definitions
must come from the OpenAPI spec. Nothing should have to be installed on the client side.

## Decision
- **Hosted only**: a remote MCP server over **Streamable HTTP**. No stdio and no distributed client package. Users add the URL
  to Claude, ChatGPT, an IDE or another MCP client.
- **Project bound at connection time**: endpoint `/mcp/projects/{projectId}`. The tool list is computed for that
  user and project, and it does not change during a connection, so `tools/list_changed` isn't needed.
- **Tool generation**: at startup, load the OpenAPI spec, keep the operations with `x-mcp.expose = true`, and for each one build
  - the name from `x-mcp.name ?? operationId`,
  - the description from `x-mcp.description ?? summary + description`,
  - the input schema from path/query params (minus `projectId`) merged with the request body schema.
  For each request, drop tools whose `x-permissions` the caller lacks.
- **Execution**: a tool call becomes an internal call to the same Hono app (`app.request(...)`) using the caller's identity,
  so validation and authorization run exactly as they do for REST.
- **Auth**: OAuth 2.1 through BetterAuth's provider plugin, including the discovery metadata and dynamic client registration
  that hosted MCP clients expect. API keys are accepted as a bearer token for scripts.
- **Stateless**: the server runs in Streamable HTTP's stateless mode, with no in-memory sessions (0011).

## Consequences
- Every exposed operation needs LLM-quality descriptions (0009).
- MCP has no capability that REST lacks. Any composite "smart" tool must first exist as an API endpoint.
  Whether to add such endpoints is open (round-2 Q12).
- Switching projects means configuring another MCP server URL in the client.
