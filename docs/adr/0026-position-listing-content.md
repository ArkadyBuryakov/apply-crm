# 0026. Position listing content

- Status: Accepted (refines 0002)
- Date: 2026-10-26
- Source: round-3 Q6

## Context
Listings are tracked by URL, but listings get taken down, and an LLM tailoring a resume needs the text. Many job sites block scrapers.

## Decision
- `Position.url` plus optional `Position.description_markdown`.
- The **server never fetches listing URLs.** The user pastes the description in the UI, or an MCP client that can
  browse fills it in when creating or updating a position.

## Consequences
- There is no scraping code, so no SSRF surface and no per-site breakage.
- The description is a snapshot. If the listing changes, the user or LLM updates it, and the audit log (ADR 0012) keeps the history.
