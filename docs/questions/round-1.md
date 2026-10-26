# Requirements grilling — round 1

Answer inline under each **Answer:** line. "Agree" is a valid answer: it accepts the default.
Answered questions turn into ADRs in `docs/adr/`.

---

## A. Domain model

### 1. Where is the job opening?
You apply to a *position*, not a company. One company can have three openings at different stages.
Without an Opportunity/Position entity, where do the pipeline stage (applied → screening → interview →
offer → rejected/ghosted), salary range, job URL and job description live?

**Default:** add `Opportunity` (organization, optional agency, position title, stage, source channel).
Actions belong to an opportunity, which belongs to a company, so "actions under a company" comes for free.

**Answer:** agree, but name it `Position`

### 2. How do Agency and Company relate?
An agency recruiter often pitches a role at an undisclosed client.
- Can an opportunity exist with an agency and no company, with the company linked later?
- Can one action (e.g. an agency call covering three roles) belong to several opportunities or companies?
- Is Agency a separate table, or `Organization { kind: company | agency }`?

**Default:** a single `Organization` table with `kind`, so contacts, channels and search work the same way for both.

**Answer:** `Position` should have optional `company` and `agency` fields. They can be in a single table, I agree on that.

### 3. Project-scoped or global entities?
If two projects both track "Acme Corp", is that two rows or one shared row?
Same question for Channels: is "LinkedIn" a global lookup or per project?

**Default:** everything is project-scoped, with no cross-tenant sharing. Channels are seeded per project from a template.

**Answer:** everything is project-scoped. There should be a config for reasonable defaults for a new projects.

### 4. Contacts over time
Recruiters switch agencies often. Is it `Contact → Organization` (current employer only) or a
`ContactAffiliation` history? Does a contact store a handle per channel (LinkedIn URL, Telegram, email)?

**Default:** an affiliation history with `from`/`to` dates, plus `ContactHandle (channel, value)`.

**Answer:** agree. from/to dates should be optional.

---

## B. Actions and the action graph

### 5. What does an edge mean?
"Follow-up of", "caused by", "blocks", "part of"? With untyped edges the graph is decoration.
With typed edges you can answer "what's blocking my offer?"

**Default:** typed edges from a small fixed enum, plus an optional note.

**Answer:** agree

### 6. Can edges cross boundaries?
Can an edge link actions belonging to different companies or opportunities
(e.g. one agency call leads to applications at two companies)?
Confirm that cross-project edges are forbidden.

**Default:** cross-company edges are allowed; cross-project edges are rejected.

**Answer:** agree

### 7. Cycles are possible but not enforced
That means every traversal (ancestors, descendants, timeline) must be cycle-safe: recursive CTEs need a
visited-path guard, and the UI tree needs a depth cap. Should creating a cycle show a soft warning?

**Default:** allow cycles, return a `warnings: ["cycle"]` field on edge creation, and make all traversals cycle-safe.

**Answer:** agree

### 8. Planned vs done
When a planned call happens, is it the same record moving `planned → done`, or a new "done" action linked
to the plan? What about `cancelled`, `rescheduled` and `no_show`?

**Default:** one record with `status`, `scheduled_at` and `completed_at`. A reschedule updates `scheduled_at` and keeps history in the audit log.

**Answer:** these are statuses. If there is reschedule - just change status and create new one.

### 9. Is the action type list fixed?
Listed now: email, call, application, take-home, task. Missing: interview (several rounds), offer, note, meeting.
Closed enum (type-specific fields, strong validation, good MCP schemas) or user-extensible types?

**Default:** a closed enum with a per-type payload as a discriminated union, which maps to OpenAPI `oneOf`.

**Answer:** agree

### 10. Files and attachments
CVs, cover letters, take-home submissions, offer PDFs. Do you need to track which CV version went to which
application? This decides whether object storage (S3/R2/local disk) is needed from day one.

**Default:** yes, with versioned `Document` entities linked to actions. Storage sits behind an interface, using local disk in development.

**Answer:** Yes, I want to keep documents. Also we need to store both versioned version of main resume and tailored versions for specific positions.

---

## C. Auth, projects, RBAC

### 11. Should Project be BetterAuth's organization plugin?
It already provides members, invitations, roles and a typed access-control definition (`createAccessControl`).
The catch: it allows multiple owners by default, and you want exactly one.

**Default:** use it, enforce single ownership in our own code, and add an explicit ownership-transfer endpoint.

**Answer:** agree

### 12. RBAC granularity
- Fixed roles (owner/editor/viewer), or custom roles per project?
- Resource × action only (`action:create`), or also row-level (private actions only the author sees)
  and field-level (hide salary or offer amounts from viewers)?
- Global roles (instance admin)?

**Default:** fixed project roles plus one instance-admin flag, with no field-level rules yet. A shared `permissions.ts`
package drives API guards, frontend visibility and MCP tool filtering.

**Answer:** agree

### 13. Who are the team members, concretely?
A career coach? A partner? A recruiter you're working with? The answer decides whether viewer/commenter roles and
private actions matter.

**Answer:** all of them, coach/personal recruiter, spouse, anyone I want to share with.

---

## D. API, OpenAPI, MCP

### 14. Which code-first stack produces the OpenAPI spec?

**Default:** Hono + `@hono/zod-openapi` + Drizzle ORM. Zod is the single source for validation, OpenAPI and TS types,
Hono mounts BetterAuth cleanly, and it runs on Node, Bun or edge.

**Answer:** agree, I had a good experience with this stack

### 15. Tool explosion
One MCP tool per OpenAPI operation could mean 40–60+ tools, which degrades LLM tool selection. Options:
- an opt-in `x-mcp` extension per operation (curated subset, custom tool name or description)
- expose everything automatically

Also: should each operation carry an `x-permissions` extension, so the MCP server filters tools from the spec
alone without duplicating rules?

**Default:** opt-in `x-mcp`, plus `x-permissions` on every operation.

**Answer:** agree

### 16. Project context in MCP
A user has different roles in different projects. Which tool list do they see?
- (a) the union, with a `projectId` parameter on every tool
- (b) a `select_project` tool, then a `tools/list_changed` notification
- (c) the project bound at connection time (e.g. `/mcp/projects/:id`)

**Default:** (c), the simplest correct RBAC filtering.

**Answer:** c

### 17. How does MCP authenticate?
The MCP spec expects OAuth 2.1 for remote servers. BetterAuth has an MCP/OIDC-provider plugin.
Do you also want personal API keys for scripts and CLI use? Transport: Streamable HTTP only, or stdio too?

**Default:** OAuth via BetterAuth plus API keys, with Streamable HTTP only.

**Answer:** agree

### 18. What does "MCP clients for this API" mean?
A generated TS SDK for the REST API? A CLI? A client that talks to the MCP server? Something else?

**Answer:** just way to connect to MCP server, if it's possible not to distribute client separately and just host MCP server - thats the best scenario.

---

## E. Operations

### 19. Deployment target
A self-hosted single instance for you and a few people, or multi-tenant SaaS?
This decides SQLite vs Postgres, Postgres RLS vs app-level `project_id` filtering, and whether the SPA is served
same-origin (cookies, simple) or cross-origin (CORS, harder).

**Default:** Postgres, app-level tenancy filtering, and the SPA served same-origin by the API server.

**Answer:** it would be a self-hosted single instance, but it should be scalable (so stateless backend). No postgres RLS, use app-level filtering.

### 20. History and concurrency
- Audit history ("who changed this stage, when") for shared projects?
- Soft delete?
- Optimistic concurrency (a `version` column / `If-Match`) for two people editing at once?

**Default:** yes to all three.

**Answer:** agree

---

## Coming in round 2
Integrations (Gmail/Calendar sync), reminders and a job runner, search, import/export, GDPR for contact data,
monorepo layout, and testing of the generated spec → MCP pipeline.
