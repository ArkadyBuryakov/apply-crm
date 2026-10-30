# 0033. Audit log is owner-only

- Status: Accepted (amends 0015)
- Date: 2026-10-30

## Context
ADR 0015 lets every member see the whole project, and the audit log was part of that. But the log shows more than the
project's current state: who did what and when, whether through the web, an API key or MCP, and the values changes replaced.

## Decision
- `audit:read` is granted to the owner only. Editors, commenters and viewers get a 403 from `listAuditEvents`.
- The rest of the trust model stands: members still see all current project data, including soft-deleted records.

## Consequences
- Ownership transfer hands over audit access along with the rest of the owner's grants.
- `audit_event` rows are still written for every member's changes.
- A planned audit log UI has to be gated on `audit:read`.
