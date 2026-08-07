import { describe, expect, it } from "vitest";
import { ShortTermMemory, estimateTokens } from "../src/short_term/index.js";

describe("ShortTermMemory", () => {
  it("does not compress while under budget", () => {
    const mem = new ShortTermMemory(1000);
    mem.push({ role: "user", content: "hi", tokenEstimate: estimateTokens("hi") });
    const result = mem.compress(() => "summary");
    expect(result.summarizedCount).toBe(0);
    expect(result.turns).toHaveLength(1);
  });

  it("compresses the oldest half of turns once over budget", () => {
    const mem = new ShortTermMemory(5);
    for (let i = 0; i < 6; i++) {
      mem.push({ role: "user", content: `message number ${i}`, tokenEstimate: 10 });
    }
    const result = mem.compress((turns) => `summarized ${turns.length} turns`);
    expect(result.summarizedCount).toBe(3);
    expect(result.turns[0]?.content).toContain("summarized 3 turns");
    expect(result.turns).toHaveLength(4); // 1 summary + 3 kept
  });
});
