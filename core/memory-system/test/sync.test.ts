import { describe, expect, it } from "vitest";
import { MemorySyncService, excludeTypes } from "../src/sync.js";
import type { MemoryRecord } from "../src/types.js";

function record(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: overrides.id ?? "id",
    type: "preference",
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

describe("MemorySyncService", () => {
  it("stages and retrieves a local change", () => {
    const service = new MemorySyncService("device-a");
    const r = record({ id: "mem-1" });
    service.stageLocalChange(r);
    expect(service.getSynced("mem-1")).toEqual(r);
  });

  it("merges remote records, newer updatedAt winning, exactly like @ryper/sync's SyncStore", () => {
    const service = new MemorySyncService("device-a");
    const older = record({ id: "mem-1", content: "old", updatedAt: "2024-01-01T00:00:00.000Z" });
    service.stageLocalChange(older);

    const newer = record({ id: "mem-1", content: "new", updatedAt: "2024-02-01T00:00:00.000Z" });
    const result = service.merge([
      {
        key: "mem-1",
        value: newer,
        updatedAt: new Date(newer.updatedAt).getTime(),
        deviceId: "device-b",
      },
    ]);

    expect(result.applied).toBe(1);
    expect(service.getSynced("mem-1")?.content).toBe("new");
  });

  it("selective sync filter excludes matching types from both staging and merge", () => {
    const filter = excludeTypes(["conversation"]);
    const service = new MemorySyncService("device-a", filter);

    const excluded = record({ id: "mem-1", type: "conversation" });
    service.stageLocalChange(excluded);
    expect(service.getSynced("mem-1")).toBeUndefined();

    const result = service.merge([
      { key: "mem-1", value: excluded, updatedAt: Date.now(), deviceId: "device-b" },
    ]);
    expect(result.applied).toBe(0);
  });

  it("snapshot() exposes every synced record", () => {
    const service = new MemorySyncService("device-a");
    service.stageLocalChange(record({ id: "a" }));
    service.stageLocalChange(record({ id: "b" }));
    expect(service.snapshot()).toHaveLength(2);
  });
});
