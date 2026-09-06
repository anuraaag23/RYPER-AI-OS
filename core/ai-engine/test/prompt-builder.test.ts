import { describe, expect, it } from "vitest";
import { PromptBuilder } from "../src/prompt-builder.js";
import { TokenBudgetManager } from "../src/token-budget.js";
import type { GatheredContext } from "../src/context-manager.js";

const emptyContext: GatheredContext = {
  retrievedDocuments: [],
  retrievedMemories: [],
  history: [],
};

describe("PromptBuilder", () => {
  it("always starts with the configured system prompt", () => {
    const builder = new PromptBuilder({ systemPrompt: "You are RYPER." });
    const messages = builder.build(emptyContext, "hi", "model-a");
    expect(messages[0]).toEqual({ role: "system", content: "You are RYPER." });
    expect(messages.at(-1)).toEqual({ role: "user", content: "hi" });
  });

  it("folds retrieved memories and documents into one context system message", () => {
    const builder = new PromptBuilder({ systemPrompt: "sys" });
    const context: GatheredContext = {
      retrievedDocuments: ["doc excerpt"],
      retrievedMemories: ["user likes tea"],
      history: [],
    };
    const messages = builder.build(context, "hi", "model-a");
    expect(messages[1]?.role).toBe("system");
    expect(messages[1]?.content).toContain("user likes tea");
    expect(messages[1]?.content).toContain("doc excerpt");
  });

  it("includes prior history turns in order between the system and user messages", () => {
    const builder = new PromptBuilder({ systemPrompt: "sys" });
    const context: GatheredContext = {
      retrievedDocuments: [],
      retrievedMemories: [],
      history: [
        { role: "user", content: "first", tokenEstimate: 1 },
        { role: "assistant", content: "reply", tokenEstimate: 1 },
      ],
    };
    const messages = builder.build(context, "second", "model-a");
    expect(messages.map((m) => m.content)).toEqual(["sys", "first", "reply", "second"]);
  });

  it("trims oldest history first when the budget would be exceeded", () => {
    const builder = new PromptBuilder({ systemPrompt: "sys" });
    const budget = new TokenBudgetManager({
      "model-a": { contextWindow: 40, reservedForCompletion: 0 },
    });
    const context: GatheredContext = {
      retrievedDocuments: [],
      retrievedMemories: [],
      history: [
        { role: "user", content: "x".repeat(80), tokenEstimate: 20 },
        { role: "assistant", content: "y".repeat(80), tokenEstimate: 20 },
      ],
    };
    const messages = builder.build(context, "final", "model-a", budget);
    // Oldest history entries get dropped until the remaining set fits.
    expect(messages.some((m) => m.content.startsWith("x"))).toBe(false);
    expect(messages.at(-1)).toEqual({ role: "user", content: "final" });
    expect(messages[0]).toEqual({ role: "system", content: "sys" });
  });
});
