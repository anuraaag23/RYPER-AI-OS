import { describe, expect, it } from "vitest";
import { LongTermMemory } from "@ryper/memory";
import { VectorStore } from "@ryper/rag";
import { ContextManager } from "../src/context-manager.js";

describe("ContextManager", () => {
  it("gathers matching long-term memories and RAG chunks for a query", async () => {
    const longTerm = new LongTermMemory();
    longTerm.add({ category: "preference", content: "prefers dark mode", importance: 0.8 });

    const vectorStore = new VectorStore(async (text) => [text.length]);
    await vectorStore.addDocument("doc1", "dark mode reduces eye strain at night");

    const manager = new ContextManager(longTerm, vectorStore);
    const gathered = await manager.gather("dark mode");

    expect(gathered.retrievedMemories.some((m) => m.includes("dark mode"))).toBe(true);
    expect(gathered.retrievedDocuments.length).toBeGreaterThan(0);
  });

  it("accumulates recorded turns as conversation history", async () => {
    const manager = new ContextManager(new LongTermMemory(), undefined);
    manager.recordUserTurn("hi");
    manager.recordAssistantTurn("hello");
    manager.recordToolTurn("tool output");

    const gathered = await manager.gather("hi");
    expect(gathered.history.map((t) => t.role)).toEqual(["user", "assistant", "tool"]);
  });

  it("converts history turns into ChatMessage shape", () => {
    const manager = new ContextManager(new LongTermMemory(), undefined);
    manager.recordUserTurn("hi");
    const messages = manager.toChatMessages(manager.getShortTermMemory().getTurns());
    expect(messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("keeps scratch values isolated until explicitly cleared", () => {
    const manager = new ContextManager(new LongTermMemory(), undefined);
    manager.setScratch("plan", { step: 1 });
    expect(manager.getScratch("plan")).toEqual({ step: 1 });
    manager.clearScratch();
    expect(manager.getScratch("plan")).toBeUndefined();
  });

  it("delegates sliding-window compression to ShortTermMemory", () => {
    const manager = new ContextManager(new LongTermMemory(), undefined, { tokenBudget: 5 });
    for (let i = 0; i < 6; i++) manager.recordUserTurn(`message ${i}`);
    manager.compress((turns) => `summary of ${turns.length}`);
    const turns = manager.getShortTermMemory().getTurns();
    expect(turns[0]?.content).toContain("summary of");
  });
});
