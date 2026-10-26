# 0029. Action type catalogue

- Status: Accepted (amends 0004 and 0013)
- Date: 2026-10-26
- Source: review of `docs/domain/action-types.md`

## Decision
- The final action types are:
  `email`, `meeting`, `interview`, `application`, `take_home`, `offer`, `reference_check`, `rejection`, `task`, `note`.
  - `call` is dropped and merged into `meeting`, which gains `direction` and `format` (`phone` | `video` | `in_person`).
  - `reference_check` and `rejection` are added. No dedicated follow-up reminder type exists: that is a `task`.
- Participant roles (ADR 0013) gain `referrer` (application) and `referee` (reference check).
- Stage and outcome suggestions (ADR 0014): `application` done → stage `applied`, `offer` → stage `offer`,
  `rejection` → `outcome = rejected`.
- Payload fields and the status × type matrix are specified in `docs/domain/action-types.md`, which is the source for
  the Zod union in `packages/shared`.

## Consequences
- An offer comparison view is not scheduled, but offer `base` pay stays structured (amount, currency, period) so it can be built later.
