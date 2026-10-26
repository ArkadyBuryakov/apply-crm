# Requirements grilling — round 2

Same format as round 1: answer under **Answer:**, and "agree" accepts the default.
Context: ADRs 0001–0012 in `docs/adr/` capture round 1.

---

## A. Domain follow-ups

### 1. What does an action attach to?
Your original requirement was "actions are stored under a company". Position now has an optional company, and some actions
have no position at all:
- an intro call with an agency recruiter before any role exists (organization only),
- "update my main resume" (project only),
- one agency call that covers three positions.

Options:
- (a) `position_id` required: no position-less actions
- (b) optional `position_id` + optional `organization_id`, both nullable, with project-level actions allowed
- (c) many-to-many `action_subject (action_id, position_id | organization_id)`

**Default:** (b). For the "one call, three positions" case, log one call and use graph edges to the follow-ups in each position.

**Answer:** c

### 2. Action participants
Which contacts took part in an action (a call with a recruiter and a hiring manager, an email from/to/cc)?

**Default:** `action_participant (action_id, contact_id, role)` with role `from` / `to` / `cc` / `attendee` / `interviewer`.

**Answer:** agree

### 3. Position pipeline stages
- Fixed enum, or configured per project (seeded from the project defaults config, ADR 0003)?
- Set manually, or derived automatically from actions (e.g. an `offer` action moves the stage to `offer`)?
- Are terminal outcomes stages or a separate field? (`rejected` by them, `withdrawn` by me, `ghosted`, `accepted`)

**Default:** per-project configurable stages from defaults, set manually. The UI and MCP *suggest* a stage change when a
matching action is logged. Outcome is a separate field: `open | accepted | rejected | withdrawn | ghosted`.

**Answer:** agree

### 4. Privacy from members
You share projects with a recruiter. Under the current RBAC (ADR 0008) a viewer sees everything, including salary
expectations, other offers and other agencies' positions. Is that acceptable?
- (a) yes, members are trusted, so share the whole project or nothing
- (b) private flag on individual records (visible to owner only)
- (c) field-level hiding of compensation for viewers

**Default:** (a) for v1, documented as "share only with people you trust with everything". Use separate projects if needed.

**Answer:** agree

### 5. Comments and collaboration
Should a coach or spouse be able to comment ("I'd push back on that salary") without edit rights?
That needs a `commenter` role and a Comment entity.

**Default:** not in v1. Viewers can't write anything.

**Answer:** add comments and commenter role.

---

## B. Background work and integrations

### 6. Reminders and notifications
Planned actions have `scheduled_at` and `due_at`. Do you want reminders?
- Channel: email? Web push? In-app only?
- Who gets them: the action creator, an assignee, all members?
- Are tasks assigned to a project member (`assignee_id`)?

**Default:** in-app plus email reminders to an assignee, defaulting to the creator. Delivered through a Postgres job queue (ADR 0011).

**Answer:** all in-app in v1. Integrations are for v2

### 7. Email and calendar integration
Logging emails by hand gets tedious fast. Options, roughly in order of effort:
- (a) manual only
- (b) a per-project inbound address (forward an email → an `email` action, matched to contacts by address)
- (c) Gmail/Outlook OAuth sync
- (d) calendar sync (planned calls/interviews ↔ Google Calendar), or a simpler ICS feed you subscribe to

**Default:** (a) plus a read-only ICS feed in v1. (b) later. (c) is out of scope because of Google's restricted-scope verification.

**Answer:** integrations for v2

### 8. Search
Search across organizations, positions, contacts, action content and document text?

**Default:** Postgres full-text search over names, titles, notes and action payload text. No document text in v1.

**Answer:** agree. let's make advanced search in v2.

### 9. Import and export
- Export: full project as JSON (+ files as a zip)? CSV per entity?
- Import: from a spreadsheet you already keep? From LinkedIn's data export?

**Default:** JSON + zip export and JSON import (round-trip, also used for backup and migration). CSV import for positions only.

**Answer:** agree

### 10. Personal data and account deletion
- Contacts are third parties' personal data. Do you care about GDPR-style "forget this person" (a hard purge, including audit diffs)?
- When a project owner deletes their account, what happens to the project? Is it deleted, or must ownership be transferred first?

**Default:** a hard-purge endpoint for contacts that also redacts audit diffs. Account deletion is blocked while the user owns projects with other members,
and sole-member projects are deleted along with the account.

**Answer:** agree

---

## C. MCP and LLM usage

### 11. Documents in MCP
Should the LLM be able to read resume and job description text through MCP (e.g. "tailor my resume for this position")?
And upload a new tailored version?
- Reading requires text extraction (PDF/DOCX → text) at upload time.
- Uploading binaries through MCP tool arguments is awkward. Markdown or plain-text versions would be easier.

**Default:** extract text at upload and expose a `get_document_version_text` tool. Allow creating document versions from
Markdown content via MCP (rendered to PDF later, or kept as `.md`).

**Answer:** for starters we can keep resume as a latex file. you can find one in my local resume folder as an example
I thought about keeping position listings as URLs

### 12. Composite or "smart" tools
Plain CRUD tools make the LLM do many round trips. Useful composite endpoints (which would also be exposed as MCP tools) could include:
- `get_position_overview`: the position plus its contacts, action timeline and documents in one call
- `get_agenda`: planned actions and overdue tasks for a date range
- `log_interaction`: create an action, its participants and an edge to the previous action in one call

Should these be first-class API endpoints?

**Default:** yes, all three. They're useful for the UI too.

**Answer:** agree

### 13. MCP prompts and resources
Besides tools, MCP supports *resources* (readable context) and *prompts* (templates like "prepare me for this interview").
Do you want either, or tools only?

**Default:** tools only in v1.

**Answer:** let's do tools for now.

---

## D. Codebase and engineering

### 14. Repository layout
**Default:** pnpm workspaces monorepo:
```
apps/api        Hono API + MCP endpoint + serves the SPA build
apps/web        Vite SPA
packages/shared Zod schemas, permissions, enums
packages/db     Drizzle schema + migrations
```
MCP lives inside `apps/api` (same process, `/mcp/...` route) and can be split out later because it is stateless.

**Answer:** agree

### 15. Runtime
Node (LTS) or Bun?

**Default:** Node LTS for production, with tsx in development. Bun can be revisited once the stack is proven on it.

**Answer:** agree

### 16. Frontend stack
- UI framework: React? Vue? Svelte? Solid?
- Routing and data: e.g. TanStack Router + TanStack Query
- Component library: shadcn/ui? Mantine? Something else?
- API client: generated from OpenAPI (`openapi-typescript` + `openapi-fetch`) or Hono RPC types (`hc`)?
- Graph visualization for the action DAG: React Flow?

**Default:** React + TanStack Router/Query + shadcn/ui + `openapi-fetch` (the same contract that external users and MCP see) + React Flow.

**Answer:** agree

### 17. Identifiers and time
- IDs: UUIDv7 (sortable, no enumeration) or prefixed IDs (`pos_…`, `act_…`)? Prefixed IDs are easier for LLMs to keep apart.
- Timezones: store UTC, plus a user timezone preference for display and reminders?

**Default:** UUIDv7 in the DB, exposed as prefixed IDs in the API (`pos_01J…`). UTC storage plus a per-user timezone.

**Answer:** agree

### 18. Registration on a self-hosted instance
Open sign-up, invite-only, or the first user becomes admin and then sign-up is closed?
Which login methods: email+password, magic link, GitHub/Google OAuth, passkeys?

**Default:** the first user becomes instance admin, then sign-up is invite-only. Email+password plus optional Google/GitHub OAuth through env config.

**Answer:** agree

### 19. Testing strategy
**Default:**
- unit tests: Vitest
- integration tests against a real Postgres (testcontainers)
- RBAC matrix generated from the spec: every operation × every role × same-project and cross-project
- an MCP contract test: generated tool list per role snapshot-tested, plus a round-trip call per exposed tool
- e2e: Playwright smoke tests for the SPA

**Answer:** agree

### 20. v1 scope
Which of these are **not** needed for the first usable version? Cutting some lets the rest ship sooner.
- teams and members (single-user first)
- documents
- action graph UI (API only at first)
- MCP
- audit log UI (logging still happens)

**Answer:** agree, but implement UI for action graph as well
