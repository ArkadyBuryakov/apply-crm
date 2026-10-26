# 0017. Import/export and personal data deletion

- Status: Accepted
- Date: 2026-10-26
- Source: round-2 Q9, Q10

## Decision
- **Export**: the full project as versioned JSON (`schemaVersion` field), plus document blobs, packed into a zip.
- **Import**: the same format, round-trippable, also used for backup and moving data between instances. IDs are remapped on import.
  CSV import is supported for positions only.
- **Contact purge**: a hard-delete endpoint (owner only) removes the contact, their handles, affiliations and participant rows,
  and **redacts** their data in `audit_event.diff`. It is the one exception to soft delete (ADR 0012).
- **Account deletion**: blocked while the user owns a project that has other members (they must transfer ownership first, ADR 0007).
  Projects where the user is the only member are deleted together with the account.

## Consequences
- The export format is a public contract, so its changes need migrations between `schemaVersion`s.
- The redaction logic must know which audit diff fields can contain contact data.
