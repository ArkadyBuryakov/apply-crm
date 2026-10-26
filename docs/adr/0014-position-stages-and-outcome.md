# 0014. Position stages and outcome

- Status: Accepted
- Date: 2026-10-26
- Source: round-2 Q3

## Context
Pipelines differ between people and markets, so the stages need to be configurable. Terminal results such as "rejected" are not steps in the pipeline.

## Decision
- `position_stage (project_id, key, label, order)` is per project and seeded from the project defaults config (ADR 0003).
  Default seed: `saved`, `applied`, `screening`, `interviewing`, `take_home`, `offer`.
- `Position.stage_id` is set **manually**. When an action whose type matches a stage is logged (e.g. `offer`), the API
  returns a `suggestions: [{ stageKey }]` hint, and the UI or LLM decides whether to apply it.
- `Position.outcome` is a separate fixed enum: `open` | `accepted` | `rejected` | `withdrawn` | `ghosted`.
- A stage cannot be deleted while positions use it, but it can be renamed or reordered.

## Consequences
- Kanban columns are stages, and the board filters by `outcome = open` by default.
- Mapping stage suggestions to action types is part of the stage config (`suggest_on_action_types`).
