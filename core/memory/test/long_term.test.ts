import { describe, expect, it } from "vitest";
import { LongTermMemory } from "../src/long_term/index.js";

describe("LongTermMemory", () => {
  it("adds and retrieves an item by id", () => {
    const mem = new LongTermMemory();
    const item = mem.add({ category: "preference", content: "prefers dark mode" });
    expect(mem.get(item.id)?.content).toBe("prefers dark mode");
  });

  it("ranks search results by relevance and importance", () => {
    const mem = new LongTermMemory();
    mem.add({ category: "fact", content: "works at Acme Corp", importance: 0.9 });
    mem.add({ category: "fact", content: "likes coffee", importance: 0.2 });

    const results = mem.search("acme");
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe("works at Acme Corp");
  });

  it("supports user editing and deletion", () => {
    const mem = new LongTermMemory();
    const item = mem.add({ category: "task", content: "buy milk" });
    mem.edit(item.id, { content: "buy oat milk" });
    expect(mem.get(item.id)?.content).toBe("buy oat milk");

    expect(mem.delete(item.id)).toBe(true);
    expect(mem.get(item.id)).toBeUndefined();
  });

  it("prunes expired items", () => {
    const mem = new LongTermMemory();
    const past = new Date(Date.now() - 1000).toISOString();
    mem.add({ category: "task", content: "expired reminder", expiresAt: past });
    mem.add({ category: "task", content: "still valid" });

    const pruned = mem.pruneExpired();
    expect(pruned).toHaveLength(1);
    expect(mem.all()).toHaveLength(1);
    expect(mem.all()[0]?.content).toBe("still valid");
  });

  it("round-trips through export/import for backup", () => {
    const mem = new LongTermMemory();
    mem.add({ category: "contact", content: "Jane Doe" });
    const exported = mem.export();

    const restored = new LongTermMemory();
    restored.import(exported);
    expect(restored.all()).toHaveLength(1);
    expect(restored.all()[0]?.content).toBe("Jane Doe");
  });
});
