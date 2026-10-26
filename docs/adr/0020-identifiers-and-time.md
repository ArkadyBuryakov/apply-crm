# 0020. Identifiers and time

- Status: Accepted
- Date: 2026-10-26
- Source: round-2 Q17

## Decision
- DB primary keys are **UUIDv7** (time-sortable and not enumerable).
- The API exposes **prefixed IDs**, Crockford base32 of the UUID with a type prefix: `org_`, `pos_`, `con_`, `chn_`, `act_`,
  `doc_`, `dv_`, `cmt_`, `prj_`. Conversion happens in the Zod (de)serialization layer. A wrong prefix returns 400.
- Timestamps are stored as `timestamptz` in UTC. Users have a `timezone` preference (IANA name) that is used for display and
  for agenda day boundaries.

## Consequences
- LLMs can't easily mix up a position ID and an action ID, and errors are caught at validation.
- BetterAuth tables keep their own ID format. Only our domain tables follow this record.
