# 0031. In-app assistant

- Status: Accepted
- Date: 2026-10-28
- Source: chat with the owner, 2026-10-28

## Context
MCP (ADR 0010) lets an external client work with a project, but it cannot see or drive the web app, and switching
between the app and a chat client is friction. We want a chat inside the SPA that can use the same operations as MCP,
search the web, read uploaded documents and screenshots, and move the user around the app.

Claude Pro/Max subscriptions cannot be used: since February 2026 Anthropic's terms restrict subscription OAuth tokens
to Claude Code and claude.ai, and third-party products must use API keys. Using the subscription remains possible
from claude.ai through the MCP connector.

## Decision

### Providers and keys
- **Bring your own key**, per user. Keys are stored in `ai_credential`, encrypted with AES-256-GCM under a key derived
  (HKDF) from `BETTER_AUTH_SECRET`. The API never returns a key, only its last four characters.
- **Multi-provider** through the Vercel AI SDK (Apache-2.0): Anthropic, OpenAI and Google. A provider is usable once
  the user has saved a key for it.
- **Manual model selection**: the model list is fetched live from each configured provider's models endpoint, so new
  models appear without a release. The chosen model is stored per chat as `provider:modelId`.

### Where the loop runs
- The agent loop runs in the API (`POST /api/projects/{projectId}/chats/{chatId}/messages`), streamed to the SPA as an
  AI SDK UI message stream (SSE) within that one request, so replicas stay stateless (ADR 0011).
- The client sends only the newest message; history is loaded from Postgres. A resubmitted assistant message (after an
  approval or a client tool result) replaces the stored message with the same id.
- Messages are stored in the AI SDK `UIMessage` format (`chat_message.parts` as jsonb).

### Tools
- **CRM tools** are the MCP catalog (ADR 0010): same generation from the OpenAPI document, same role filtering, and
  executed in-process with `app.request()` as the user, so validation, authorization and audit are identical. Audit
  rows record `via: "chat"`.
- **Approval mode** is chosen per chat:
  - `manual`: every CRM tool call waits for the user,
  - `read`: reads run automatically, writes and deletes wait,
  - `write`: reads and writes run automatically, deletes wait,
  - `all`: everything runs automatically.

  "Write" and "delete" come from the HTTP method (`DELETE` is a delete). Approval is a safety net, not a security
  boundary: the user can already do anything the tools do through the REST API.
- **Navigation** is a client-side tool. The SPA derives it from the router: every route with a `staticData.description`
  is navigable, its path params come from the path, and its search params from the route's zod `validateSearch` schema
  (converted to JSON Schema). The SPA sends this definition with each request; the browser executes the call.
- **Web search** uses each provider's built-in tool (Anthropic web search and web fetch, OpenAI web search, Google
  Search grounding) and is toggled per chat. Searches are billed to the user's key.

- **Reading documents**: a new API operation, `readDocumentVersion` (also an MCP tool), returns the text of any
  document version: LaTeX sources, uploaded text files as they are, and text extracted from PDFs (`unpdf`) and Word
  files (the `.docx` XML, read with `fflate`). Without it, models only saw the metadata of uploaded files.

### Attachments
- Images, PDFs and text files (Markdown, LaTeX, CSV, JSON, plain text) up to 20 MB, uploaded to object storage under
  `projects/{projectId}/chats/{chatId}/`. Messages reference them by URL; the server inlines the bytes when calling
  the model (text files become text, so every provider can read them).

### History and visibility
- Chats belong to one project and are **private to their author** (an exception to ADR 0015's "members see
  everything": chats run on a personal key and may contain uploads meant for nobody else). Other members cannot list
  or open them.
- Chats are hard-deleted with their attachments; they are not domain data and are not part of export (ADR 0017).
- The SPA keeps the open chat per browser tab (`sessionStorage`, keyed by project). Reloading keeps it; a new tab or
  "New chat" starts a new one. Older chats are reopened from the history list.

### UI
- A resizable right sidebar in the project layout, toggled from the header or with Ctrl/⌘+J, open across navigation.

## Consequences
- The API depends on `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai` and `@ai-sdk/google`; the SPA on `ai`,
  `@ai-sdk/react`, `react-markdown` and `remark-gfm`.
- Rotating `BETTER_AUTH_SECRET` makes stored provider keys unreadable; users have to enter them again.
- Route search params are now declared as zod schemas in `router.tsx`.
- Provider differences (web search with function tools, PDF support) surface as provider errors in the chat rather
  than being hidden.
