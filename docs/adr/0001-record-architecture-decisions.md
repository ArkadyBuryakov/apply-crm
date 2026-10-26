# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-10-26

## Context
The project is in the requirements phase. Decisions are being made before any code exists, and they need to stay traceable.

## Decision
Use lightweight ADRs (a subset of MADR): `Status`, `Context`, `Decision`, `Consequences`. Store them in `docs/adr/NNNN-slug.md`.
Requirement questions and the answers to them live in `docs/questions/round-N.md` and feed the ADRs.

## Consequences
- Every non-obvious design choice must have an ADR before it is implemented.
- A changed decision gets a new ADR that supersedes the old one, rather than an edit.
