import { describe, expect, it } from "vitest";
import { MemoryStatistics } from "../src/statistics.js";
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
    updatedAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

describe("MemoryStatistics", () => {
  it("counts records by lifecycle state and type", () => {
    const stats = new MemoryStatistics(new MemoryExpirationManager());
    const records = [
      record({ id: "a", type: "task", lifecycleState: "active" }),
      record({ id: "b", type: "preference", lifecycleState: "active" }),
      record({ id: "c", lifecycleState: "archived" }),
      record({ id: "d", lifecycleState: "deleted" }),
    ];
    const snapshot = stats.snapshot(records);
    expect(snapshot.totalActive).toBe(2);
    expect(snapshot.totalArchived).toBe(1);
    expect(snapshot.totalDeleted).toBe(1);
    expect(snapshot.countByType.task).toBe(1);
    expect(snapshot.countByType.preference).toBe(1);
  });

  it("counts pinned records among active ones", () => {
    const stats = new MemoryStatistics(new MemoryExpirationManager());
    const records = [record({ id: "a", pinned: true }), record({ id: "b", pinned: false })];
    expect(stats.snapshot(records).pinnedCount).toBe(1);
  });

  it("reports the oldest and newest updatedAt among active records", () => {
    const stats = new MemoryStatistics(new MemoryExpirationManager());
    const records = [
      record({ id: "a", updatedAt: "2024-01-01T00:00:00.000Z" }),
      record({ id: "b", updatedAt: "2024-06-01T00:00:00.000Z" }),
    ];
    const snapshot = stats.snapshot(records);
    expect(snapshot.oldestUpdatedAt).toBe("2024-01-01T00:00:00.000Z");
    expect(snapshot.newestUpdatedAt).toBe("2024-06-01T00:00:00.000Z");
  });

  it("counts records expiring within the lookahead window but not already expired", () => {
    const now = Date.now();
    const expiration = new MemoryExpirationManager({
      task: { autoExpire: true, defaultTtlMs: 2000 },
    });
    const stats = new MemoryStatistics(expiration);
    const records = [
      record({ id: "already-expired", updatedAt: new Date(now - 10_000).toISOString() }),
      record({ id: "expiring-soon", updatedAt: new Date(now - 1500).toISOString() }),
      record({ id: "fresh", updatedAt: new Date(now).toISOString() }),
    ];
    const snapshot = stats.snapshot(records, 1000, now);
    expect(snapshot.expiringSoonCount).toBe(1);
  });
});
