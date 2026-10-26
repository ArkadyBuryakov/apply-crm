import { type IdKind, toPublicId } from "@crm/shared";

export const pid = (kind: IdKind, uuid: string) => toPublicId(kind, uuid);
export const pidOrNull = (kind: IdKind, uuid: string | null | undefined) => (uuid ? toPublicId(kind, uuid) : null);
export const iso = (d: Date) => d.toISOString();
export const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);
/** Postgres `date` columns come back as YYYY-MM-DD strings. */
export const dateOrNull = (d: string | null | undefined) => d ?? null;
