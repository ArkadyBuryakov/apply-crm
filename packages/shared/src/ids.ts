// Prefixed public IDs (ADR 0020): UUIDv7 in the database, `<prefix>_<26 Crockford base32 chars>` in the API.
import { v7 as uuidv7 } from "uuid";

export const ID_PREFIXES = {
  project: "prj",
  user: "usr",
  invitation: "inv",
  organization: "org",
  position: "pos",
  stage: "stg",
  contact: "con",
  affiliation: "aff",
  handle: "hdl",
  channel: "chn",
  action: "act",
  comment: "cmt",
  notification: "ntf",
  document: "doc",
  documentVersion: "dv",
  template: "tpl",
  templateVersion: "tv",
  chat: "cht",
  chatAttachment: "cha",
  projectMemory: "pmem",
  userMemory: "umem",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const DECODE: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) {
  DECODE[ALPHABET[i]!] = i;
  DECODE[ALPHABET[i]!.toLowerCase()] = i;
}

export function newUuid(): string {
  return uuidv7();
}

/** Encodes a UUID (128 bits) as 26 Crockford base32 characters, most significant bits first. */
export function encodeUuid(uuid: string): string {
  let n = BigInt(`0x${uuid.replaceAll("-", "")}`);
  let out = "";
  for (let i = 0; i < 26; i++) {
    out = ALPHABET[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

export function decodeToUuid(encoded: string): string | null {
  if (encoded.length !== 26) return null;
  let n = 0n;
  for (const ch of encoded) {
    const v = DECODE[ch];
    if (v === undefined) return null;
    n = (n << 5n) | BigInt(v);
  }
  if (n >> 128n) return null;
  const hex = n.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function toPublicId(kind: IdKind, uuid: string): string {
  return `${ID_PREFIXES[kind]}_${encodeUuid(uuid)}`;
}

/** Returns the UUID for a public ID of the given kind, or null if the prefix or encoding is wrong. */
export function fromPublicId(kind: IdKind, publicId: string): string | null {
  const prefix = `${ID_PREFIXES[kind]}_`;
  if (!publicId.startsWith(prefix)) return null;
  return decodeToUuid(publicId.slice(prefix.length));
}

/** No flags: the pattern is published in the OpenAPI document, where regex flags cannot be expressed. */
export function publicIdPattern(kind: IdKind): RegExp {
  return new RegExp(`^${ID_PREFIXES[kind]}_[0-9A-HJKMNP-TV-Z]{26}$`);
}
