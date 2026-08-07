import { describe, expect, it } from "vitest";
import { ToolRecoveryPlanner, ToolRetryPlanner } from "../src/tool-retry.js";
import type { ToolResult, ToolSpec } from "../src/types.js";

function spec(overrides: Partial<ToolSpec> = {}): ToolSpec {
  return {
    id: "t1",
    name: "Tool",
    description: "d",
    category: "system",
    version: "1.0.0",
    author: "test",
    capabilities: [],
    permissions: [],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    examples: [],
    errorCodes: [],
    executionCost: "low",
    timeoutMs: 1000,
    cancellationSupport: false,
    streamingSupport: false,
    ...overrides,
  };
}

function result(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    invocationId: "i1",
    toolId: "t1",
    status: "error",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 5,
    attempts: 1,
    ...overrides,
  };
}

describe("ToolRetryPlanner", () => {
  const planner = new ToolRetryPlanner();

  it("gives a low-cost tool more retries than a high-cost one", () => {
    expect(planner.planFor(spec({ executionCost: "low" })).maxAttempts).toBe(3);
    expect(planner.planFor(spec({ executionCost: "high" })).maxAttempts).toBe(1);
  });

  it("retries a timeout or error result under the attempt cap", () => {
    const policy = planner.planFor(spec({ executionCost: "low" }));
    expect(planner.shouldRetry(result({ status: "error", attempts: 1 }), policy)).toBe(true);
    expect(planner.shouldRetry(result({ status: "error", attempts: 3 }), policy)).toBe(false);
  });

  it("never retries a validation or permission failure", () => {
    const policy = planner.planFor(spec({ executionCost: "low" }));
    expect(planner.shouldRetry(result({ status: "validation_error", attempts: 1 }), policy)).toBe(
      false,
    );
    expect(planner.shouldRetry(result({ status: "permission_denied", attempts: 1 }), policy)).toBe(
      false,
    );
  });

  it("computes exponential backoff delays", () => {
    const policy = { maxAttempts: 5, backoffMs: 100, backoffMultiplier: 2 };
    expect(planner.delayForAttempt(policy, 1)).toBe(100);
    expect(planner.delayForAttempt(policy, 2)).toBe(200);
    expect(planner.delayForAttempt(policy, 3)).toBe(400);
  });
});

describe("ToolRecoveryPlanner", () => {
  const planner = new ToolRecoveryPlanner();

  it("gives permission-denied results a permission-focused suggestion", () => {
    const step = planner.planFor(spec(), result({ status: "permission_denied" }));
    expect(step.suggestion).toContain("capability");
  });

  it("gives timeout results a retry/fallback suggestion", () => {
    const step = planner.planFor(spec({ timeoutMs: 5000 }), result({ status: "timeout" }));
    expect(step.description).toContain("5000ms");
  });

  it("gives validation errors a context-resolver suggestion", () => {
    const step = planner.planFor(spec(), result({ status: "validation_error" }));
    expect(step.suggestion).toContain("Context Resolver");
  });

  it("falls back to a generic failure message for anything else", () => {
    const step = planner.planFor(spec(), result({ status: "error", errorMessage: "boom" }));
    expect(step.description).toContain("boom");
  });
});
