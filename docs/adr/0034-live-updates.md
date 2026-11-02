# 0034. Live updates

- Status: Accepted
- Date: 2026-10-30

## Context
Only the browser that made a change refreshed its data. Changes from agents over MCP, API scripts, the worker and other
members stayed invisible until the tab was hidden and shown again or reloaded. Everything that can be changed through MCP has to show up without that.

## Decision
- **Events** are `{ projectId | userId, entityType, entityId, operationType }`, with public IDs and no other data.
  Clients refetch through the normal API, so permissions on the data are enforced only there.
- **Backend writes announce themselves.** The `defineRoute` guard wraps every non-GET project or user route. `audit()`
  records what a write touched, and after a success the guard publishes those entries. A write that audited nothing
  gets a generic `other` event, so a new route is covered without doing anything. A route opts out with `changes: false`;
  chats and marking notifications read do, because other members must not learn about them.
- **The worker publishes by hand** with `publishChanges`, as jobs declare no scope a wrapper could use.
- **Delivery** uses Postgres `NOTIFY`, which reaches every replica from any process. `GET /api/projects/{id}/events` is
  an SSE stream behind the normal guard. Project events go to streams of that project whose role can read the entity
  type (`ENTITIES` in `services/changes.ts`, exhaustive by type). User events go only to that user's streams.
- **Access is checked when a stream opens.** Streams are closed on `member` and `project` events, when the `LISTEN`
  connection reconnects, and after `CHANGE_STREAM_MAX_AGE_MS` (5 minutes), which bounds how long an expired session or
  a deleted project keeps a stream.
- **The SPA invalidates the whole project** on any event, debounced, and again after every reconnect. Lists, the agenda
  and the graph show entities without their IDs in the query key, so invalidating by ID would leave them stale. Only the
  queries on screen refetch. This replaced the polling of notifications and of compile status.

## Consequences
- Each replica holds one more Postgres connection once a stream is open, and an in-memory list of streams. Neither has
  to survive a restart (ADR 0011): clients reconnect to any replica and refetch.
- A crash between commit and publish loses that event; the data catches up at the next reconnect, within 5 minutes.
  The same bound applies to compile status now that it is not polled.
- A form open on a changed record keeps its copy, and saving it still gets the usual 412.
- Each tab holds a connection. Browsers allow 6 per host over HTTP/1.1, which matters in local development with many tabs.
- Record-level access would need a lookup in the filter. The event already has the `entityId` for it.
