import { describe, expect, it } from "vitest";
import { MemoryDeduplicator } from "../src/deduplication.js";
import type { MemoryRecord } from "../src/types.js";

function record(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: overrides.id ?? "id",
    type: "knowledge",
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

describe("MemoryDeduplicator", () => {
  it("groups records with exactly matching content within the same type", () => {
    const dedup = new MemoryDeduplicator();
    const records = [
      record({ id: "a", content: "likes tea", updatedAt: "2024-01-01T00:00:00.000Z" }),
      record({ id: "b", content: "likes tea", updatedAt: "2024-01-02T00:00:00.000Z" }),
    ];
    const groups = dedup.findDuplicates(records);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.reason).toBe("exact-content");
    expect(groups[0]?.keep.id).toBe("b"); // more recently updated wins
  });

  it("never treats records of different types as duplicates", () => {
    const dedup = new MemoryDeduplicator();
    const records = [
      record({ id: "a", type: "task", content: "same text" }),
      record({ id: "b", type: "preference", content: "same text" }),
    ];
    expect(dedup.findDuplicates(records)).toHaveLength(0);
  });

  it("groups near-duplicates by embedding similarity above the threshold", () => {
    const dedup = new MemoryDeduplicator(0.9);
    const records = [
      record({ id: "a", content: "coffee is great", embedding: [1, 0, 0] }),
      record({ id: "b", content: "coffee is wonderful", embedding: [0.99, 0.01, 0] }),
    ];
    const groups = dedup.findDuplicates(records);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.reason).toBe("high-similarity");
  });

  it("does not group embeddings below the similarity threshold", () => {
    const dedup = new MemoryDeduplicator(0.99);
    const records = [
      record({ id: "a", content: "a", embedding: [1, 0, 0] }),
      record({ id: "b", content: "b", embedding: [0, 1, 0] }),
    ];
    expect(dedup.findDuplicates(records)).toHaveLength(0);
  });
});
