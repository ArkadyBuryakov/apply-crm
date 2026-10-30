# 0015. Commenter role and comments

- Status: Accepted (amends 0008), trust model amended by 0033
- Date: 2026-10-26
- Source: round-2 Q4, Q5

## Context
Members such as a coach or a spouse should be able to give feedback without editing data. Privacy within a project stays
all-or-nothing.

## Decision
- Roles become `owner`, `editor`, `commenter`, `viewer`. A commenter has viewer permissions plus `comment:create` and
  management of their own comments.
- `comment (project_id, author_id, target_type, target_id, body_markdown, created_at, edited_at?, deleted_at?)`.
  Allowed targets: `organization`, `position`, `contact`, `action`, `document`.
- Authors can edit and delete their own comments. The owner can delete any comment. Editors can comment but can't moderate others' comments.
- **Trust model**: anyone who is a member can see the whole project, salary and other offers included. There are no private records or hidden fields.
  The UI's invite screen states this. Use a separate project to share less.

## Consequences
- Comments are a team feature. Per ADR 0023 they ship together with members, not in v1.
- @mentions and comment notifications follow from the notification model (ADR 0016) once members exist.
