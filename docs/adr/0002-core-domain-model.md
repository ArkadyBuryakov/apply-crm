# 0002. Core domain model

- Status: Accepted, action anchoring refined by 0013 and listing content by 0026
- Date: 2026-10-26
- Source: round-1 Q1–Q4

## Context
The initial entity list (Company, Agency, Contact, Channel, Action) had no entity for the job opening itself.
One company can have several openings at different stages, and agencies often pitch roles at undisclosed clients.

## Decision

### Organization
A single table covers both companies and agencies.

| Field | Notes |
|---|---|
| `kind` | `company` \| `agency` |
| `name`, `website`, `notes` | |

### Position
A job opening that is being pursued. It holds the pipeline state.

| Field | Notes |
|---|---|
| `company_id` | optional, FK → Organization(kind=company). May be unknown at first (undisclosed client) |
| `agency_id` | optional, FK → Organization(kind=agency) |
| `title`, `url`, `description` | |
| `salary_min`, `salary_max`, `salary_currency`, `salary_period` | all optional |
| `stage` | pipeline stage (value set: see round-2 Q3) |
| `source_channel_id` | optional, FK → Channel |

Rule: a company can be attached to an agency-only position later.

### Contact
A person. Employment is tracked as history rather than as a single FK.

- `ContactAffiliation (contact_id, organization_id, title?, from?, to?)`: both dates are optional. A row with an empty `to` is a current affiliation.
- `ContactHandle (contact_id, channel_id, value)`: email, LinkedIn URL, Telegram, phone, and so on.

### Channel
An application or communication channel, such as LinkedIn, email, phone, a company careers site or a job board. It is used for
`Position.source_channel_id`, `ContactHandle.channel_id` and actions.

## Consequences
- The UI and API treat companies and agencies the same way (search, contacts, actions), with filtering by `kind`.
- Position is the main unit of the pipeline. Where actions attach (position, organization, or nothing) is an open question: see round-2 Q1.
- Kind constraints on `company_id`/`agency_id` are checked in the application, because a plain FK cannot express them.
