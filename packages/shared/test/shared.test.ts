import { describe, expect, it } from "vitest";
import {
  ACTION_PAYLOAD_SCHEMAS,
  ACTION_TYPES,
  ALLOWED_STATUSES,
  decodeToUuid,
  encodeUuid,
  fromPublicId,
  newUuid,
  permissionsOf,
  roleHas,
  toPublicId,
} from "../src/index.js";

describe("public ids", () => {
  it("round-trips UUIDs", () => {
    for (let i = 0; i < 200; i++) {
      const uuid = newUuid();
      expect(decodeToUuid(encodeUuid(uuid))).toBe(uuid);
    }
    expect(decodeToUuid(encodeUuid("ffffffff-ffff-ffff-ffff-ffffffffffff"))).toBe(
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
    );
    expect(decodeToUuid(encodeUuid("00000000-0000-0000-0000-000000000000"))).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
  });

  it("checks prefixes", () => {
    const uuid = newUuid();
    const id = toPublicId("position", uuid);
    expect(id).toMatch(/^pos_[0-9A-Z]{26}$/);
    expect(fromPublicId("position", id)).toBe(uuid);
    expect(fromPublicId("action", id)).toBeNull();
    expect(fromPublicId("position", "pos_short")).toBeNull();
    expect(fromPublicId("position", "pos_UUUUUUUUUUUUUUUUUUUUUUUUUU")).toBeNull();
  });

  it("keeps time ordering of UUIDv7", () => {
    const a = toPublicId("action", newUuid());
    const b = toPublicId("action", newUuid());
    expect(a < b).toBe(true);
  });
});

describe("action payloads", () => {
  it("has a schema and status list for every type", () => {
    for (const t of ACTION_TYPES) {
      expect(ACTION_PAYLOAD_SCHEMAS[t]).toBeDefined();
      expect(ALLOWED_STATUSES[t].length).toBeGreaterThan(0);
    }
  });

  it("validates offers", () => {
    expect(
      ACTION_PAYLOAD_SCHEMAS.offer.safeParse({
        base: { amount: 100000, currency: "EUR", period: "year" },
        decision: "pending",
      }).success,
    ).toBe(true);
    expect(ACTION_PAYLOAD_SCHEMAS.offer.safeParse({ decision: "pending" }).success).toBe(false);
  });
});

describe("permissions", () => {
  it("orders roles by privilege", () => {
    expect(roleHas("owner", "project:transfer", "contact:purge", "membership:manage")).toBe(true);
    expect(roleHas("editor", "position:create", "edge:create")).toBe(true);
    expect(roleHas("editor", "membership:manage")).toBe(false);
    expect(roleHas("commenter", "comment:create")).toBe(true);
    expect(roleHas("commenter", "position:update")).toBe(false);
    expect(roleHas("viewer", "comment:create")).toBe(false);
    expect(roleHas("viewer", "position:read")).toBe(true);
  });

  it("gives every role a superset of viewer", () => {
    const viewer = new Set(permissionsOf("viewer"));
    for (const role of ["owner", "editor", "commenter"] as const) {
      const granted = new Set(permissionsOf(role));
      for (const p of viewer) expect(granted.has(p)).toBe(true);
    }
  });
});
