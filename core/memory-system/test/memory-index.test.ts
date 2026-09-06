import { describe, expect, it } from "vitest";
import { MemoryIndex } from "../src/memory-index.js";
import type { MemoryRecord } from "../src/types.js";

function record(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "id",
    type: "preference",
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

describe("MemoryIndex", () => {
  it("filters by type", () => {
    const index = new MemoryIndex();
    const records = [record({ id: "a", type: "preference" }), record({ id: "b", type: "task" })];
    index.rebuild(records);
    expect(index.matchIds({ type: "task" }, records)).toEqual(new Set(["b"]));
  });

  it("filters by tag", () => {
    const index = new MemoryIndex();
    const records = [record({ id: "a", tags: ["work"] }), record({ id: "b", tags: ["home"] })];
    index.rebuild(records);
    expect(index.matchIds({ tag: "work" }, records)).toEqual(new Set(["a"]));
  });

  it("filters by pinned status", () => {
    const index = new MemoryIndex();
    const records = [record({ id: "a", pinned: true }), record({ id: "b", pinned: false })];
    index.rebuild(records);
    expect(index.matchIds({ pinnedOnly: true }, records)).toEqual(new Set(["a"]));
  });

  it("intersects multiple filter dimensions", () => {
    const index = new MemoryIndex();
    const records = [
      record({ id: "a", type: "task", tags: ["work"] }),
      record({ id: "b", type: "task", tags: ["home"] }),
      record({ id: "c", type: "preference", tags: ["work"] }),
    ];
    index.rebuild(records);
    expect(index.matchIds({ type: "task", tag: "work" }, records)).toEqual(new Set(["a"]));
  });

  it("filters by lifecycle state", () => {
    const index = new MemoryIndex();
    const records = [
      record({ id: "a", lifecycleState: "active" }),
      record({ id: "b", lifecycleState: "archived" }),
    ];
    index.rebuild(records);
    expect(index.matchIds({ lifecycleState: "archived" }, records)).toEqual(new Set(["b"]));
  });

  it("an empty filter matches everything", () => {
    const index = new MemoryIndex();
    const records = [record({ id: "a" }), record({ id: "b" })];
    index.rebuild(records);
    expect(index.matchIds({}, records)).toEqual(new Set(["a", "b"]));
  });
});
