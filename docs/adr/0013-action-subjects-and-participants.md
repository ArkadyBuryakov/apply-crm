# 0013. Action subjects and participants

- Status: Accepted, participant roles extended by 0029
- Date: 2026-10-26
- Source: round-2 Q1, Q2

## Context
An action can concern one position, several positions (an agency call covering three roles), an organization
with no position yet (an intro call with an agency), or nothing specific ("update main resume").

## Decision
- `action_subject (action_id, position_id?, organization_id?)`, many-to-many. Each row sets **exactly one** of the two
  FKs (enforced by a CHECK constraint).
- An action with zero subjects is a project-level action.
- Organization timelines are **derived**: the timeline of org X contains actions with subject X, plus actions with
  a subject position whose `company_id` or `agency_id` is X. The org is not stored redundantly on position-subject rows, so linking
  a company to an agency-only position later updates its timeline automatically.
- `action_participant (action_id, contact_id, role)`, where role is `from`, `to`, `cc`, `attendee` or `interviewer`.
- All subjects and participants must belong to the action's project (ADR 0003).

## Consequences
- The ADR 0002 note "actions belong to a position" is replaced by this record.
- Timeline queries union two paths (direct org subject and via position). This calls for indexes on `action_subject(position_id)`,
  `action_subject(organization_id)`, `position(company_id)` and `position(agency_id)`.
- The API accepts `subjects` and `participants` arrays on create and update. `logInteraction` (ADR 0018) sets them in one call.
