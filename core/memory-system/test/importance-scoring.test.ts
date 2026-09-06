import { describe, expect, it } from "vitest";
import { ImportanceScorer } from "../src/importance-scoring.js";

describe("ImportanceScorer", () => {
  it("returns the explicit importance when provided, clamped to 0..1", () => {
    const scorer = new ImportanceScorer();
    expect(
      scorer.score({ type: "task", explicitImportance: 0.42, pinned: false, accessCount: 0 }),
    ).toBe(0.42);
    expect(
      scorer.score({ type: "task", explicitImportance: 1.5, pinned: false, accessCount: 0 }),
    ).toBe(1);
    expect(
      scorer.score({ type: "task", explicitImportance: -1, pinned: false, accessCount: 0 }),
    ).toBe(0);
  });

  it("blends type weight, pin status, and access count when no explicit value is given", () => {
    const scorer = new ImportanceScorer();
    const base = scorer.score({ type: "conversation", pinned: false, accessCount: 0 });
    const pinned = scorer.score({ type: "conversation", pinned: true, accessCount: 0 });
    const accessed = scorer.score({ type: "conversation", pinned: false, accessCount: 10 });
    expect(pinned).toBeGreaterThan(base);
    expect(accessed).toBeGreaterThan(base);
  });

  it("never exceeds 1 even with every boost stacked", () => {
    const scorer = new ImportanceScorer();
    const score = scorer.score({ type: "preference", pinned: true, accessCount: 100 });
    expect(score).toBeLessThanOrEqual(1);
  });

  it("scoreRecord derives inputs from a MemoryRecord", () => {
    const scorer = new ImportanceScorer();
    const score = scorer.scoreRecord({
      id: "a",
      type: "task",
      content: "x",
      tags: [],
      metadata: {},
      importance: 0.1,
      pinned: true,
      lifecycleState: "active",
      createdAt: "now",
      updatedAt: "now",
      version: 1,
    });
    expect(score).toBeGreaterThan(0);
  });
});
