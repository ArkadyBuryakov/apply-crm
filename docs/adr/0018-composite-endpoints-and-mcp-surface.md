# 0018. Composite endpoints and MCP surface

- Status: Accepted
- Date: 2026-10-26
- Source: round-2 Q12, Q13

## Context
Plain CRUD tools force the LLM into many round trips. ADR 0010 requires every MCP tool to be an API operation.

## Decision
- Add first-class composite API operations, used by both the UI and MCP:
  - `getPositionOverview`: the position plus its company and agency, contacts, action timeline (with edges) and documents
  - `getAgenda`: planned actions and overdue tasks in a date range, optionally filtered by assignee
  - `logInteraction`: create an action with subjects, participants and an optional edge to a previous action, in one transaction
- The MCP server exposes **tools only**: no MCP resources and no prompts for now.

## Consequences
- Composite operations follow the same permission rules: `logInteraction` requires `action:create` and `edge:create`.
- Overview payloads must be bounded (pagination or a size limit on the timeline) to stay within LLM context.
