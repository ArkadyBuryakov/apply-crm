# 0016. Notifications, search and integrations scope

- Status: Accepted, "no job runner in v1" superseded by 0024
- Date: 2026-10-26
- Source: round-2 Q6, Q7, Q8

## Decision

### Notifications (v1: in-app only)
- **Time-based** reminders (upcoming, due or overdue actions) are **computed at read time** from `scheduled_at`/`due_at`
  by the agenda query (`getAgenda`, ADR 0018). They are not stored as rows and no scheduler is involved.
- **Event-based** notifications (assigned to you, comment on something you follow) are rows written synchronously in the same
  transaction as the triggering change, and they only matter once members exist.
- Actions get an optional `assignee_id` (a project member), which defaults to the creator.

### Search (v1)
Postgres full-text search (`tsvector`) over organization and contact names, position title and description, and action title and
payload text. Advanced search (facets, document text, fuzzy matching) is v2.

### Integrations (v2)
Email reminders, the inbound email address, Gmail/Outlook sync, calendar sync and the ICS feed are all deferred to v2.

## Consequences
- v1 needs **no background job runner**. The Postgres job queue from ADR 0011 arrives with v2 integrations.
- Users without the app open get no reminders in v1. This is accepted.
