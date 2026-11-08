# 0036. View state in URLs

- Status: Accepted, refines 0031
- Date: 2026-11-06

## Context
Tabs, the opened action, the selected document version, agenda filters and the pipeline's phone stage lived in
component state. A link could only open a page in its default view, Back did not undo a selection, every browser tab
was titled "Apply CRM", and the assistant only knew the bare path of the page the user was on (ADR 0031).

## Decision
- **What a user looks at goes in the URL; what they are typing does not.** Search params hold views and selections:
  | Page | Params |
  |---|---|
  | Every project page | `action` (`act_…`): that action's details, opened over the page |
  | Position | `tab`: `graph`, `people`, `documents`, `listing`, `comments` (timeline when absent) |
  | Organization | `tab`: `people`, `timeline`, `comments` (positions when absent) |
  | Document | `version` (version number), `view`: `pdf`, `source`, `log` |
  | Agenda | `assignee`, `from`, `to` |
  | Pipeline | `closed`; `stage` (stage key), used by the phone board only |

  Create and edit forms for other records, confirmations, the graph's edge dialogs and the assistant panel stay in
  component state: they hold unsaved input, and a link to a half-filled form means nothing.
- **Defaults are left out of the URL**, and params that do not parse are dropped (`.catch(undefined)`), so an old or
  hand-edited link still opens the page.
- **History.** Opening an action pushes an entry, so Back closes it; closing it in the app goes back when the app
  opened it and otherwise removes the param. Tabs, filters, versions and stages replace the entry.
- **One action dialog per project.** `action` is a search param of the `/p/$projectId` route; the project layout
  renders the dialog. Lists, the graph and search open an action by setting the param (`useOpenAction`), seeding the
  query cache with the row they already have. An action that no longer exists drops the param.
- **Titles.** Pages set `document.title` with `useDocumentTitle`: detail pages their record ("Senior Backend ·
  CryoCloud"), list pages their name, and an open action is put in front. Browser tabs and history get real names.
- **Assistant context.** Each message carries the page's title next to its URL, and the prompt says "The user is
  looking at *title* (*url*)". The navigation tool includes search params of parent routes, so the assistant can open
  any of these views, an action over a page included.

## Consequences
- New tabs, filters and detail views should get a search param, described in the route's zod schema so the assistant
  can navigate to them.
- Switching tabs re-renders the route from its search params instead of local state; tab panels must not rely on
  being remounted (they already did not).
- Links built without `search` reset the view, which is the expected behaviour for navigation between records.
