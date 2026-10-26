# Requirements grilling — round 3

Same format: answer under **Answer:**, and "agree" accepts the default.
Context: round-2 answers are captured in ADRs 0013–0023.

---

## A. v1 scope

### 1. Is MCP really out of v1?
I read your Q20 answer as: v1 is single-user, with no documents and **no MCP**, but includes the action graph UI (ADR 0023, still *Proposed*).
MCP was a headline requirement, and for a single user it may be the most useful part, since Claude could log calls and
emails for you. It is also cheap once the spec carries `x-mcp`: a generator plus one OAuth flow.
- (a) confirm: MCP comes after v1
- (b) MCP is in v1, with documents and teams still deferred
- (c) MCP in v1 with **API-key auth only**, and OAuth (needed for claude.ai/ChatGPT connectors) later

**Default:** (b).

**Answer:** Where did I say no MCP in v1? It should be there.

### 2. Is RBAC plumbing built in v1 anyway?
Even with a single user, every route would declare permissions and emit `x-permissions`, and the role map would exist.
ADR 0023 assumes yes, because retrofitting it onto every route later costs more.

**Default:** agree.

**Answer:** yes, RBAC in v1

---

## B. Documents (LaTeX)

Your existing workflow (a local resume folder) is one folder per position, each holding a
tailored `.tex`, a copy of `resume.cls` and the compiled PDF. That means a document version is a **bundle of files**, not one file.

### 3. What is in a version?
- (a) a bundle: the main `.tex` plus any extra files, with an optional compiled PDF attached
- (b) the `.tex` only, with `resume.cls` stored once per project as a shared **template asset** that versions reference
- (c) the PDF only, with the source kept outside the app

**Default:** (b). The `.cls` changes rarely, and duplicating it in every tailored version is how copies drift apart.
A version = `.tex` source (text, so an LLM can read and edit it) + a template reference + an optional PDF.

**Answer:** agree

### 4. Who compiles the PDF?
- (a) you compile locally and upload the PDF next to the source
- (b) the server compiles it (e.g. Tectonic in a sandboxed worker). This adds a heavy dependency, needs a job runner,
  and LaTeX compilation must run with shell-escape disabled because `\write18` can execute commands
- (c) the server compiles it through an external service

**Default:** (a) at first, (b) later. Compilation is the one thing that would bring the job runner back into scope.

**Answer:** b - let's do a worker. We can use pgboss for scheduling

### 5. Importing your existing resumes
Should there be a one-time import of your resume folders that creates a position (by folder name) and a tailored resume
version for each, linked to the main resume?

**Default:** yes, as a CLI script that uses the public API (it doubles as a test of the API).

**Answer:** agree

---

## C. Position listings

### 6. Listing as a URL only, or also its content?
You want to keep listings as URLs. But listings are taken down once filled, and an LLM tailoring a resume needs the
text, not the link. Server-side fetching is unreliable, because LinkedIn and many ATSs block scrapers.

**Default:** keep `url` plus an optional `description_markdown`. The user pastes the text, or the MCP client (which can browse)
fills it in when creating the position. The server never scrapes.

**Answer:** agree

---

## D. Details

### 7. Action payload fields
Each action type gets its own payload (ADR 0004). Instead of more questions, I'd draft
`docs/domain/action-types.md` with proposed fields per type (e.g. interview: round, format, duration; offer: base,
equity, bonus, deadline) for you to review in place.

**Default:** agree, I'll draft it next.

**Answer:** agree

### 8. Hosting
Where will the instance run (VPS, home server, Fly/Railway)? Who terminates TLS (Caddy, Traefik, the platform)?
This affects only the deploy docs and the `docker-compose` example, not the architecture.

**Answer:** VPS on coolify with postgres also on coolify

### 9. Backups
`pg_dump` on a schedule plus object-storage snapshots, or rely on JSON export (ADR 0017)?

**Default:** document a `pg_dump` + MinIO mirror recipe in the deploy docs. JSON export is for portability, not backup.

**Answer:** Can you do backup upload S3-like private storage?

### 10. Public repository and license
Will the repo be public? If so, which license (MIT, AGPL for a hosted app, …)? This affects whether example data, such as
your resume, can be committed.

**Answer:** nothing personal and/or private should be committed. Copy-left license that does not allow code to be used in commercial products
