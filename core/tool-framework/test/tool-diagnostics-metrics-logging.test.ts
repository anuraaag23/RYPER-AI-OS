import { describe, expect, it } from "vitest";
import { ToolDiagnostics } from "../src/tool-diagnostics.js";
import { ToolMetrics } from "../src/tool-metrics.js";
import { ToolInvocationLogger } from "../src/tool-logging.js";
import type { ToolInvocationRequest, ToolResult } from "../src/types.js";

function result(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    invocationId: "i1",
    toolId: "t1",
    status: "ok",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 10,
    attempts: 1,
    ...overrides,
  };
}

function request(overrides: Partial<ToolInvocationRequest> = {}): ToolInvocationRequest {
  return {
    toolId: "t1",
    parameters: {},
    actorId: "actor-1",
    sessionId: "s1",
    platform: "windows",
    ...overrides,
  };
}

describe("ToolDiagnostics", () => {
  it("tracks total invocations and a bounded recent history", () => {
    const diagnostics = new ToolDiagnostics(2);
    diagnostics.record(result({ invocationId: "1" }));
    diagnostics.record(result({ invocationId: "2" }));
    diagnostics.record(result({ invocationId: "3" }));
    expect(diagnostics.totalInvocations()).toBe(3);
    expect(diagnostics.recent().map((r) => r.invocationId)).toEqual(["2", "3"]);
  });

  it("computes a recent failure rate", () => {
    const diagnostics = new ToolDiagnostics(10);
    diagnostics.record(result({ status: "ok" }));
    diagnostics.record(result({ status: "error" }));
    const summary = diagnostics.summary();
    expect(summary.totalInvocations).toBe(2);
    expect(summary.recentFailureRate).toBe(0.5);
  });
});

describe("ToolMetrics", () => {
  it("aggregates per-tool counters and computes derived stats", () => {
    const metrics = new ToolMetrics();
    metrics.record(result({ toolId: "t1", status: "ok", durationMs: 10 }));
    metrics.record(result({ toolId: "t1", status: "error", durationMs: 20 }));
    const snapshot = metrics.snapshot("t1");
    expect(snapshot).toMatchObject({
      invocations: 2,
      successes: 1,
      failures: 1,
      totalDurationMs: 30,
    });
    expect(snapshot?.averageDurationMs).toBe(15);
    expect(snapshot?.successRate).toBe(0.5);
  });

  it("returns undefined for a tool with no recorded invocations", () => {
    expect(new ToolMetrics().snapshot("never-called")).toBeUndefined();
  });

  it("ranks tools by invocation count for mostUsedTools", () => {
    const metrics = new ToolMetrics();
    metrics.record(result({ toolId: "a" }));
    metrics.record(result({ toolId: "b" }));
    metrics.record(result({ toolId: "b" }));
    const top = metrics.mostUsedTools(1);
    expect(top[0]?.toolId).toBe("b");
  });
});

describe("ToolInvocationLogger", () => {
  it("records and retrieves entries by invocation id and tool id", () => {
    const logger = new ToolInvocationLogger();
    logger.record(request({ actorId: "actor-1" }), result({ invocationId: "i1", toolId: "t1" }));
    logger.record(request({ actorId: "actor-2" }), result({ invocationId: "i2", toolId: "t1" }));

    expect(logger.findByInvocationId("i1")?.actorId).toBe("actor-1");
    expect(logger.findByToolId("t1")).toHaveLength(2);
    expect(logger.all()).toHaveLength(2);
  });

  it("evicts the oldest entry once the history size is exceeded", () => {
    const logger = new ToolInvocationLogger(1);
    logger.record(request(), result({ invocationId: "i1" }));
    logger.record(request(), result({ invocationId: "i2" }));
    expect(logger.all().map((e) => e.invocationId)).toEqual(["i2"]);
  });
});
