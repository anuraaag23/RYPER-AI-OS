import { describe, expect, it } from "vitest";
import { chunkText, VectorStore } from "../src/index.js";

describe("chunkText", () => {
  it("splits long text into overlapping chunks", () => {
    const text = "a".repeat(1000);
    const chunks = chunkText("doc1", text, { maxChars: 300, overlapChars: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.id).toBe("doc1#0");
  });

  it("returns a single chunk for short text", () => {
    const chunks = chunkText("doc1", "short text");
    expect(chunks).toHaveLength(1);
  });

  it("rejects invalid options", () => {
    expect(() => chunkText("doc1", "text", { maxChars: 10, overlapChars: 10 })).toThrow();
  });
});

// Deterministic fake embedding: bag-of-words presence vector over a fixed vocabulary,
// good enough to prove ranking behaves correctly without a real model.
const VOCAB = ["cat", "dog", "invoice", "revenue", "quarter"];
const fakeEmbed = async (text: string): Promise<number[]> => {
  const lower = text.toLowerCase();
  return VOCAB.map((term) => (lower.includes(term) ? 1 : 0));
};

describe("VectorStore", () => {
  it("ranks the most relevant chunk first", async () => {
    const store = new VectorStore(fakeEmbed);
    await store.addDocument("finance", "Quarterly revenue grew this quarter.");
    await store.addDocument("pets", "The cat chased the dog around the yard.");

    const results = await store.search("revenue quarter");
    expect(results[0]?.documentId).toBe("finance");
  });

  it("returns no results when nothing matches", async () => {
    const store = new VectorStore(fakeEmbed);
    await store.addDocument("pets", "The cat chased the dog.");
    const results = await store.search("invoice revenue");
    expect(results).toHaveLength(0);
  });

  it("tracks indexed chunk count", async () => {
    const store = new VectorStore(fakeEmbed);
    await store.addDocument("doc1", "cat dog invoice revenue quarter");
    expect(store.size()).toBeGreaterThan(0);
  });
});
