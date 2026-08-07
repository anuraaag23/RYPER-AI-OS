import { describe, expect, it } from "vitest";
import { MemoryVersionHistory } from "../src/version-history.js";
import type { MemoryRecord } from "../src/types.js";

function record(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "mem-1",
    type: "task",
    content: "x",
    tags: [],
    metadata: {},
    importance: 0.5,
    pinned: false,
    lifecycleState: "active",
    createdAt: "now",
    updatedAt: "now",
    version: 1,
    ...overrides,
  };
}

describe("MemoryVersionHistory", () => {
  it("stores snapshots in order and retrieves the full history", () => {
    const history = new MemoryVersionHistory();
    history.snapshot(record({ version: 1, content: "v1" }));
    history.snapshot(record({ version: 2, content: "v2" }));
    expect(history.getHistory("mem-1").map((r) => r.content)).toEqual(["v1", "v2"]);
  });

  it("getVersion retrieves a specific version", () => {
    const history = new MemoryVersionHistory();
    history.snapshot(record({ version: 1, content: "v1" }));
    history.snapshot(record({ version: 2, content: "v2" }));
    expect(history.getVersion("mem-1", 1)?.content).toBe("v1");
  });

  it("getPreviousVersion finds the version right before the current one", () => {
    const history = new MemoryVersionHistory();
    history.snapshot(record({ version: 1, content: "v1" }));
    history.snapshot(record({ version: 2, content: "v2" }));
    expect(history.getPreviousVersion("mem-1", 2)?.content).toBe("v1");
  });

  it("forget() clears a memory's history", () => {
    const history = new MemoryVersionHistory();
    history.snapshot(record({ version: 1 }));
    history.forget("mem-1");
    expect(history.getHistory("mem-1")).toHaveLength(0);
  });
});
