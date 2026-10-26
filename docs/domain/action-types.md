# Action types — payload draft

Status: **accepted** (ADR 0029). Reviewed 2026-10-26.
This becomes the Zod discriminated union in `packages/shared` (ADR 0004).

Conventions: `?` = optional. Money is `{ amount: number, currency: ISO-4217 }`. Durations are in minutes.
Contacts never appear in payloads: they are `action_participant` rows (ADR 0013). Files are `action_attachment` rows (ADR 0006).

---

## Common fields (every type)

| Field | Type | Notes |
|---|---|---|
| `type` | enum | discriminator |
| `status` | `planned` \| `done` \| `cancelled` \| `no_show` \| `rescheduled` | allowed values are restricted per type, see below |
| `title` | string | short label for timelines, e.g. "Intro call with recruiter" |
| `notes?` | markdown | free text |
| `scheduled_at?` | timestamp | when it is or was supposed to happen |
| `completed_at?` | timestamp | set when the status becomes `done` |
| `due_at?` | timestamp | deadline (tasks, take-homes, offer decisions) |
| `channel_id?` | id | where it happened (LinkedIn, email, phone, …) |
| `assignee_id?` | user id | defaults to the creator (ADR 0016) |
| `subjects[]` | positions / organizations | ADR 0013 |
| `participants[]` | `{ contact_id, role }` | ADR 0013 |

---

## `email`
| Field | Type | Notes |
|---|---|---|
| `direction` | `inbound` \| `outbound` | |
| `subject?` | string | |
| `body?` | markdown | pasted body or summary |
| `message_id?` | string | RFC 5322 Message-ID, reserved for v2 mail sync |

Statuses: `planned` (a draft or scheduled send), `done`, `cancelled`.
Participant roles: `from`, `to`, `cc`.

## `meeting`
Any synchronous conversation that isn't an interview: recruiter and agency calls, networking, coffee chats.

| Field | Type | Notes |
|---|---|---|
| `direction?` | `inbound` \| `outbound` | who initiated it |
| `format` | `phone` \| `video` \| `in_person` | |
| `location?` | string | address |
| `link?` | url | video link |
| `duration_min?` | int | |
| `summary?` | markdown | what was discussed |

Statuses: all. Participant roles: `attendee`.

## `interview`
| Field | Type | Notes |
|---|---|---|
| `round?` | int | 1, 2, 3, … within the position |
| `kind` | `screening` \| `technical` \| `live_coding` \| `system_design` \| `behavioral` \| `hiring_manager` \| `panel` \| `culture` \| `final` \| `other` | |
| `format` | `phone` \| `video` \| `onsite` | |
| `location?` / `link?` | string / url | |
| `duration_min?` | int | |
| `prep?` | markdown | preparation notes, questions to ask |
| `debrief?` | markdown | what was asked and how it went |
| `self_rating?` | 1–5 | your own impression |

Statuses: all. Participant roles: `interviewer`, `attendee`.

## `application`
| Field | Type | Notes |
|---|---|---|
| `method` | `portal` \| `easy_apply` \| `email` \| `referral` \| `agency` \| `other` | |
| `application_url?` | url | the ATS or portal page, if different from `Position.url` |
| `confirmation_ref?` | string | ATS application ID |

Statuses: `planned` (want to apply), `done` (applied), `cancelled`.
Participant roles: `referrer` (a new role), `to`.
Attachments: the exact resume and cover-letter versions sent.

Stage suggestion: `done` suggests moving the position to stage `applied` (ADR 0014).

## `take_home`
| Field | Type | Notes |
|---|---|---|
| `brief?` | markdown | the assignment, or a link to it |
| `brief_url?` | url | |
| `estimated_hours?` | number | given by the company |
| `spent_hours?` | number | actual |
| `submission_url?` | url | repo or upload link |

`due_at` = submission deadline. Statuses: `planned` (received, in progress), `done` (submitted), `cancelled` (declined to do it).
Attachments: the submission archive, if any.

## `offer`
| Field | Type | Notes |
|---|---|---|
| `base` | money + `period` (`year` \| `month` \| `hour`) | |
| `bonus?` | money or string | target bonus |
| `sign_on?` | money | |
| `equity?` | string | free text: "0.1% over 4y, 1y cliff" |
| `benefits?` | markdown | |
| `start_date?` | date | |
| `decision` | `pending` \| `negotiating` \| `accepted` \| `declined` | |

`due_at` = decision deadline. Statuses: `done` (offer received). A counter-offer is a new `offer` action linked by a `follow_up` edge.
Attachments: the offer letter.

`base` stays structured so that an offer comparison view (normalized to yearly totals) can be added later. The view itself is not scheduled.

## `reference_check`
The company contacts one of your referees.

| Field | Type | Notes |
|---|---|---|
| `relationship?` | string | e.g. "former manager at X" |
| `outcome?` | `positive` \| `neutral` \| `negative` \| `unknown` | as far as you know |

Statuses: `planned` (referee details given), `done` (check happened), `cancelled`.
Participant roles: `referee` (a new role), `to` (who asked for it).

## `rejection`
The company or agency rejects you. Records the event and the feedback. The terminal state itself is `Position.outcome` (ADR 0014).

| Field | Type | Notes |
|---|---|---|
| `by` | `company` \| `agency` | |
| `stage_key?` | string | stage the position was at, filled from the position on create |
| `reason?` | string | as stated |
| `feedback?` | markdown | |

Statuses: `done` only. Outcome suggestion: logging a rejection suggests `Position.outcome = rejected`.

## `task`
| Field | Type | Notes |
|---|---|---|
| `priority` | `low` \| `normal` \| `high` | default `normal` |
| `checklist?` | `{ text, done }[]` | lightweight subtasks; use `subtask` edges for real ones |

Statuses: `planned` (open), `done`, `cancelled`.

## `note`
| Field | Type | Notes |
|---|---|---|
| — | | content goes in the common `notes` field |

Statuses: `done` only (a note is a record, never planned).

---

## Status × type matrix

| | planned | done | cancelled | no_show | rescheduled |
|---|---|---|---|---|---|
| email | ✓ | ✓ | ✓ | | |
| meeting | ✓ | ✓ | ✓ | ✓ | ✓ |
| interview | ✓ | ✓ | ✓ | ✓ | ✓ |
| application | ✓ | ✓ | ✓ | | |
| take_home | ✓ | ✓ | ✓ | | ✓ (deadline extension) |
| offer | | ✓ | | | |
| reference_check | ✓ | ✓ | ✓ | | |
| rejection | | ✓ | | | |
| task | ✓ | ✓ | ✓ | | ✓ |
| note | | ✓ | | | |
