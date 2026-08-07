import { describe, expect, it } from "vitest";
import { MemoryRankingEngine } from "../src/ranking-engine.js";
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
    updatedAt: "now",
    version: 1,
    ...overrides,
  };
}

describe("MemoryRankingEngine", () => {
  it("boosts a higher-importance record even with equal relevance", () => {
    const engine = new MemoryRankingEngine();
    const now = Date.now();
    const ranked = engine.rank(
      [
        {
          record: record({ id: "low", importance: 0.2, updatedAt: new Date(now).toISOString() }),
          score: 0.5,
        },
        {
          record: record({ id: "high", importance: 0.9, updatedAt: new Date(now).toISOString() }),
          score: 0.5,
        },
      ],
      now,
    );
    expect(ranked[0]?.record.id).toBe("high");
  });

  it("gives a pinned record a small boost over an otherwise-identical one", () => {
    const engine = new MemoryRankingEngine();
    const now = Date.now();
    const ranked = engine.rank(
      [
        {
          record: record({ id: "unpinned", pinned: false, updatedAt: new Date(now).toISOString() }),
          score: 0.5,
        },
        {
          record: record({ id: "pinned", pinned: true, updatedAt: new Date(now).toISOString() }),
          score: 0.5,
        },
      ],
      now,
    );
    expect(ranked[0]?.record.id).toBe("pinned");
  });

  it("prefers more recently updated records when relevance/importance are equal", () => {
    const engine = new MemoryRankingEngine();
    const now = Date.now();
    const ranked = engine.rank(
      [
        {
          record: record({
            id: "old",
            updatedAt: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
          }),
          score: 0.5,
        },
        { record: record({ id: "new", updatedAt: new Date(now).toISOString() }), score: 0.5 },
      ],
      now,
    );
    expect(ranked[0]?.record.id).toBe("new");
  });
});
