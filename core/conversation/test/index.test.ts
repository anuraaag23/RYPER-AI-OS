import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { ModelRouter, type ModelProvider } from "@ryper/model-router";
import { LongTermMemory } from "@ryper/memory";
import { VectorStore } from "@ryper/rag";
import { ConversationEngine } from "../src/index.js";

const echoLocal: ModelProvider = {
  id: "local",
  target: "local",
  generate: async (prompt) => `local-reply: ${prompt}`,
};

function buildEngine() {
  const bus = new EventBus();
  const router = new ModelRouter(bus);
  router.registerProvider(echoLocal);
  const longTerm = new LongTermMemory();
  const embed = async (text: string) => [text.length];
  const vectorStore = new VectorStore(embed);
  return {
    bus,
    router,
    longTerm,
    vectorStore,
    engine: new ConversationEngine(router, longTerm, vectorStore, bus),
  };
}

describe("ConversationEngine", () => {
  it("routes locally when offline and returns the provider's reply", async () => {
    const { engine } = buildEngine();
    const reply = await engine.sendMessage("c1", "hello there", { device: { online: false } });
    expect(reply.routingTarget).toBe("local");
    expect(reply.content).toContain("hello there");
  });

  it("pulls in long-term memory as retrieved context", async () => {
    const { engine, longTerm } = buildEngine();
    longTerm.add({ category: "preference", content: "prefers concise answers", importance: 0.9 });

    const reply = await engine.sendMessage("c1", "concise", { device: { online: false } });
    expect(reply.retrievedContext.some((c) => c.includes("concise answers"))).toBe(true);
  });

  it("emits a conversation.turn_completed event after each turn", async () => {
    const { engine, bus } = buildEngine();
    let emitted = false;
    bus.on("conversation.turn_completed", () => {
      emitted = true;
    });

    await engine.sendMessage("c1", "hi", { device: { online: false } });
    expect(emitted).toBe(true);
  });

  it("accumulates turns in short-term memory", async () => {
    const { engine } = buildEngine();
    await engine.sendMessage("c1", "first", { device: { online: false } });
    await engine.sendMessage("c1", "second", { device: { online: false } });
    expect(engine.getShortTermMemory().getTurns()).toHaveLength(4); // 2 user + 2 assistant
  });
});
