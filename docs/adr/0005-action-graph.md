# 0005. Action graph

- Status: Accepted
- Date: 2026-10-26
- Source: round-1 Q5–Q7

## Context
Actions form a directed many-to-many graph (e.g. a call leads to two applications, and each application leads to a take-home).
Loops are not expected, but enforcing their absence isn't worth the cost.

## Decision
- Table `action_edge (project_id, parent_id, child_id, kind, note?)`, with PK `(parent_id, child_id, kind)`.
- Direction always points **parent → child** ("child happened because of / after parent").
- `kind` is a fixed enum:

  | kind | meaning |
  |---|---|
  | `follow_up` | child is a follow-up of parent |
  | `subtask` | child is part of parent |
  | `blocks` | parent must finish before child can proceed |
  | `rescheduled` | child replaces the rescheduled parent (0004) |
  | `related` | a loose link, used when nothing else fits |

- Edges may connect actions of different positions or organizations. Edges across projects are rejected.
- **Cycles are allowed.** Creating an edge that closes a cycle succeeds, and the response includes `warnings: ["cycle"]`.
- Every traversal (ancestors, descendants, subgraph) is cycle-safe: recursive CTEs carry a visited-path array
  and stop on revisit, and they take a `maxDepth` parameter with a server-side cap.

## Consequences
- The UI renders the graph as a DAG/tree with cycle markers. It cannot assume a topological order exists.
- Cycle detection on insert costs a single reachability query, which is cheap at expected sizes (hundreds of actions per project).
- The edge list can be revisited. Adding a kind is a non-breaking enum extension.
