# 0023. v1 scope

- Status: Accepted
- Date: 2026-10-26
- Source: round-2 Q20, round-3 Q1–Q2, round-4 Q1

## Context
The round-2 Q20 answer ("agree, but implement UI for action graph as well") was misread as cutting MCP. Round 3 corrected that:
MCP and RBAC are in v1. Round 4 settled the remaining items.

## Decision
**In v1**
- Auth (ADR 0021) and projects
- RBAC: permission declarations on every route, `x-permissions`, role map, frontend gating (ADR 0008)
- MCP server with OAuth and API keys (ADR 0010, 0018)
- Organizations, positions (stages, outcome, listing content), contacts, channels
- Actions (all types and statuses, subjects and participants, reschedule)
- Action graph: API **and** UI (React Flow)
- Composite endpoints, in-app agenda, basic full-text search
- Audit log writing, soft delete, optimistic concurrency
- JSON export and import
- Project members, invitations, commenter role and comments (ADR 0015)
- Documents, LaTeX templates, compile worker, resume import (ADR 0024, 0025)

**After v1**
- Audit log UI (the data is recorded from day one)

**Deferred to v2 (confirmed)**
- Integrations: email reminders, mail and calendar sync, ICS feed (ADR 0016)
- Advanced search
