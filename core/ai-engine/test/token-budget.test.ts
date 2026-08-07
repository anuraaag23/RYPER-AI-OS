import { describe, expect, it } from "vitest";
import { TokenBudgetManager } from "../src/token-budget.js";
import type { ChatMessage } from "../src/types.js";

const limits = { "model-a": { contextWindow: 100, reservedForCompletion: 20 } };

describe("TokenBudgetManager", () => {
  it("computes the prompt budget as context window minus reserved completion tokens", () => {
    const manager = new TokenBudgetManager(limits);
    expect(manager.promptBudget("model-a")).toBe(80);
  });

  it("throws for an unconfigured model id", () => {
    const manager = new TokenBudgetManager(limits);
    expect(() => manager.limitsFor("unknown-model")).toThrow(/no token limits/);
  });

  it("flags when a message set would exceed budget", () => {
    const manager = new TokenBudgetManager(limits);
    const short: ChatMessage[] = [{ role: "user", content: "hi" }];
    const long: ChatMessage[] = [{ role: "user", content: "x".repeat(400) }]; // ~100 tokens estimated

    expect(manager.wouldExceed("model-a", short)).toBe(false);
    expect(manager.wouldExceed("model-a", long)).toBe(true);
  });

  it("reports remaining budget accurately", () => {
    const manager = new TokenBudgetManager(limits);
    const messages: ChatMessage[] = [{ role: "user", content: "x".repeat(40) }]; // ~10 tokens
    expect(manager.remainingBudget("model-a", messages)).toBe(70);
  });
});
