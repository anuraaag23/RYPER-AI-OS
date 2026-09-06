import { describe, expect, it } from "vitest";
import { MemoryExpirationManager } from "../src/expiration.js";
import type { MemoryRecord } from "../src/types.js";

function record(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: overrides.id ?? "id",
    type: "task",
    content: "x",
    tags: [],
    metadata: {},
    importance: 0.5,
    pinned: false,
    lifecycleState: "active",
    createdAt: "now",
    updatedAt: "2024-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("MemoryExpirationManager", () => {
  it("treats an explicit expiresAt as authoritative", () => {
    const manager = new MemoryExpirationManager();
    const now = Date.now();
    const expired = record({ expiresAt: new Date(now - 1000).toISOString() });
    const notYet = record({ expiresAt: new Date(now + 1000).toISOString() });
    expect(manager.isExpired(expired, now)).toBe(true);
    expect(manager.isExpired(notYet, now)).toBe(false);
  });

  it("never expires a pinned record even past its TTL", () => {
    const manager = new MemoryExpirationManager({ task: { autoExpire: true, defaultTtlMs: 1000 } });
    const now = Date.now();
    const pinned = record({ pinned: true, updatedAt: new Date(now - 10_000).toISOString() });
    expect(manager.isExpired(pinned, now)).toBe(false);
  });

  it("applies a type's defaultTtlMs when autoExpire is on and no explicit expiresAt is set", () => {
    const manager = new MemoryExpirationManager({ task: { autoExpire: true, defaultTtlMs: 1000 } });
    const now = Date.now();
    const stale = record({ updatedAt: new Date(now - 5000).toISOString() });
    const fresh = record({ updatedAt: new Date(now).toISOString() });
    expect(manager.isExpired(stale, now)).toBe(true);
    expect(manager.isExpired(fresh, now)).toBe(false);
  });

  it("does not expire anything when autoExpire is off, regardless of age", () => {
    const manager = new MemoryExpirationManager({ task: { autoExpire: false, defaultTtlMs: 1 } });
    const now = Date.now();
    const veryStale = record({ updatedAt: new Date(now - 1_000_000).toISOString() });
    expect(manager.isExpired(veryStale, now)).toBe(false);
  });

  it("findOverflow prunes the oldest records beyond a type's maxItems cap", () => {
    const manager = new MemoryExpirationManager({ task: { autoExpire: false, maxItems: 2 } });
    const records = [
      record({ id: "a", updatedAt: "2024-01-01T00:00:00.000Z" }),
      record({ id: "b", updatedAt: "2024-01-02T00:00:00.000Z" }),
      record({ id: "c", updatedAt: "2024-01-03T00:00:00.000Z" }),
    ];
    const overflow = manager.findOverflow(records);
    expect(overflow.map((r) => r.id)).toEqual(["a"]);
  });

  it("findOverflow never counts pinned records against the cap", () => {
    const manager = new MemoryExpirationManager({ task: { autoExpire: false, maxItems: 1 } });
    const records = [
      record({ id: "a", pinned: true, updatedAt: "2024-01-01T00:00:00.000Z" }),
      record({ id: "b", updatedAt: "2024-01-02T00:00:00.000Z" }),
    ];
    expect(manager.findOverflow(records)).toHaveLength(0);
  });
});
