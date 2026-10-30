# 0032. Assistant memory

- Status: Accepted
- Date: 2026-10-29
- Source: chat with the owner, 2026-10-29

## Context
Every chat with the in-app assistant (ADR 0031) and every MCP conversation (ADR 0010) starts from scratch: the user
repeats their background, preferences and the goals of the search. Some of that is about the person and holds in
every project, some is about one job search. The user must be able to see and correct what agents keep.

## Decision

### Two scopes
- **User memory** (`user_memory`) belongs to one user, applies in all of their projects and is private to them, like
  chats (ADR 0031). Hard-deleted, not audited, not exported with a project.
- **Project memory** (`project_memory`) is project data like any other entity (ADR 0003, 0012): visible to every
  member, versioned, soft-deleted, audited and part of export/import (ADR 0017). A new `memory` resource is readable by
  every role and writable by editors and owners.

A memory is a one-line `title` and Markdown `content` (up to 10 000 characters). There are no types, tags or links:
agents and the user decide what is worth keeping.

### How agents use it
- REST operations under `/api/me/memories` and `/api/projects/{projectId}/memories` are exposed as MCP tools, so the
  in-app assistant and external MCP clients read and write memory the same way. Updates and deletes take the current
  `version`.
- Both are given every memory up front with guidance on what to save: the assistant in a system message of its own,
  after the cached instructions, since saving a memory changes it; MCP clients in the server instructions. Beyond
  30 000 characters, memories are listed by title only.
- Memory writes go through the chat's approval mode like any other write.

### UI
- A project page, "Memory", lists project memory and the user's memory, with add, edit and delete. The account page
  shows the user's memory too.

## Consequences
- Memory is loaded on every assistant turn and every MCP request (two small queries).
- Memories travel into the prompt verbatim, so a large memory costs tokens on every call; the budget bounds it.
- Exports gained a `memories` array; archives without one still import.
