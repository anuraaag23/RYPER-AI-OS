import { describe, expect, it } from "vitest";
import { MemoryIndex } from "../src/memory-index.js";
import { EmbeddingService } from "../src/embedding-service.js";
import { SemanticSearchEngine } from "../src/semantic-search.js";
import type { MemoryRecord } from "../src/types.js";

function record(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: overrides.id ?? "id",
    type: "knowledge",
    content: "",
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

// Deterministic fake embedding: bag-of-words over a fixed vocabulary.
const VOCAB = ["cat", "dog", "revenue", "quarter"];
const fakeEmbed = async (text: string): Promise<number[]> => {
  const lower = text.toLowerCase();
  return VOCAB.map((term) => (lower.includes(term) ? 1 : 0));
};

describe("SemanticSearchEngine", () => {
  it("pure keyword search (hybridWeight 0) ranks by term overlap", async () => {
    const index = new MemoryIndex();
    const records = [
      record({ id: "a", content: "quarterly revenue grew" }),
      record({ id: "b", content: "the cat chased the dog" }),
    ];
    index.rebuild(records);
    const engine = new SemanticSearchEngine(index, new EmbeddingService(fakeEmbed));

    const results = await engine.search("revenue", records, { hybridWeight: 0 });
    expect(results[0]?.record.id).toBe("a");
  });

  it("pure vector search (hybridWeight 1) ranks by embedding similarity", async () => {
    const index = new MemoryIndex();
    const records = [
      record({ id: "a", content: "revenue", embedding: await fakeEmbed("revenue quarter") }),
      record({ id: "b", content: "pets", embedding: await fakeEmbed("cat dog") }),
    ];
    index.rebuild(records);
    const engine = new SemanticSearchEngine(index, new EmbeddingService(fakeEmbed));

    const results = await engine.search("revenue quarter", records, { hybridWeight: 1 });
    expect(results[0]?.record.id).toBe("a");
  });

  it("applies the index filter before scoring", async () => {
    const index = new MemoryIndex();
    const records = [
      record({ id: "a", type: "knowledge", content: "revenue up" }),
      record({ id: "b", type: "task", content: "revenue report due" }),
    ];
    index.rebuild(records);
    const engine = new SemanticSearchEngine(index, new EmbeddingService(fakeEmbed));

    const results = await engine.search("revenue", records, {
      filter: { type: "task" },
      hybridWeight: 0,
    });
    expect(results.map((r) => r.record.id)).toEqual(["b"]);
  });

  it("searchByMetadata does exact-match filtering with no scoring", () => {
    const index = new MemoryIndex();
    const records = [
      record({ id: "a", metadata: { subject: "coffee" } }),
      record({ id: "b", metadata: { subject: "tea" } }),
    ];
    const engine = new SemanticSearchEngine(index, new EmbeddingService(fakeEmbed));
    expect(engine.searchByMetadata(records, { subject: "coffee" }).map((r) => r.id)).toEqual(["a"]);
  });

  it("findRelated ranks by embedding similarity to a target record, excluding itself", async () => {
    const index = new MemoryIndex();
    const target = record({ id: "target", embedding: await fakeEmbed("cat dog") });
    const records = [
      target,
      record({ id: "similar", embedding: await fakeEmbed("cat dog") }),
      record({ id: "different", embedding: await fakeEmbed("revenue quarter") }),
    ];
    const engine = new SemanticSearchEngine(index, new EmbeddingService(fakeEmbed));

    const related = engine.findRelated(target, records);
    expect(related.map((r) => r.record.id)).toEqual(["similar"]);
  });

  it("findRelated returns nothing for a record without an embedding", () => {
    const index = new MemoryIndex();
    const target = record({ id: "target" });
    const engine = new SemanticSearchEngine(index, new EmbeddingService(fakeEmbed));
    expect(engine.findRelated(target, [target])).toEqual([]);
  });
});
