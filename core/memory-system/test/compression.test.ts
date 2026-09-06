import { describe, expect, it } from "vitest";
import { MemoryCompressor } from "../src/compression.js";
import type { MemoryRecord } from "../src/types.js";

function record(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: overrides.id ?? "id",
    type: "conversation",
    content: "x",
    tags: [],
    metadata: {},
    importance: 0.3,
    pinned: false,
    lifecycleState: "active",
    createdAt: "now",
    updatedAt: "now",
    version: 1,
    ...overrides,
  };
}

const OLD_DATE = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago

describe("MemoryCompressor", () => {
  it("selects old, low-importance, unpinned records of the target type", () => {
    const compressor = new MemoryCompressor();
    const records = [
      record({ id: "a", updatedAt: OLD_DATE, importance: 0.2 }),
      record({ id: "b", updatedAt: OLD_DATE, importance: 0.2 }),
      record({ id: "c", updatedAt: OLD_DATE, importance: 0.2 }),
      record({ id: "pinned", updatedAt: OLD_DATE, importance: 0.2, pinned: true }),
      record({ id: "recent", updatedAt: new Date().toISOString(), importance: 0.2 }),
      record({ id: "important", updatedAt: OLD_DATE, importance: 0.9 }),
    ];
    const candidates = compressor.selectCandidates(records, {
      type: "conversation",
      olderThanMs: 30 * 24 * 60 * 60 * 1000,
      maxImportance: 0.5,
    });
    expect(candidates.map((c) => c.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns no candidates below the minimum group size", () => {
    const compressor = new MemoryCompressor();
    const records = [record({ id: "a", updatedAt: OLD_DATE, importance: 0.2 })];
    const candidates = compressor.selectCandidates(records, {
      type: "conversation",
      olderThanMs: 30 * 24 * 60 * 60 * 1000,
      maxImportance: 0.5,
      minGroupSize: 3,
    });
    expect(candidates).toHaveLength(0);
  });

  it("compress() calls the injected summarizer and returns a summary input plus compressed ids", async () => {
    const compressor = new MemoryCompressor();
    const candidates = [record({ id: "a" }), record({ id: "b" })];
    const result = await compressor.compress(
      candidates,
      (records) => `summarized ${records.length} memories`,
    );
    expect(result?.summaryInput.content).toBe("summarized 2 memories");
    expect(result?.compressedIds).toEqual(["a", "b"]);
  });

  it("compress() returns undefined for an empty candidate list", async () => {
    const compressor = new MemoryCompressor();
    const result = await compressor.compress([], async () => "unused");
    expect(result).toBeUndefined();
  });
});
