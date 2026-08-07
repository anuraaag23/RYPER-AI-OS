import { describe, expect, it } from "vitest";
import { CapabilityDiagnostics, CapabilityMetrics } from "../src/capability-diagnostics.js";
import type { CapabilityInvocationOutcome } from "../src/capability-diagnostics.js";

function outcome(
  overrides: Partial<CapabilityInvocationOutcome> = {},
): CapabilityInvocationOutcome {
  return {
    domain: "notifications",
    operation: "send",
    platform: "windows",
    ok: true,
    durationMs: 10,
    ...overrides,
  };
}

describe("CapabilityDiagnostics", () => {
  it("records and filters history by domain", () => {
    const diagnostics = new CapabilityDiagnostics(10);
    diagnostics.record(outcome({ domain: "notifications" }));
    diagnostics.record(outcome({ domain: "camera" }));
    expect(diagnostics.recent("notifications")).toHaveLength(1);
    expect(diagnostics.recent()).toHaveLength(2);
  });

  it("evicts the oldest entry once the history size is exceeded", () => {
    const diagnostics = new CapabilityDiagnostics(2);
    diagnostics.record(outcome({ operation: "a" }));
    diagnostics.record(outcome({ operation: "b" }));
    diagnostics.record(outcome({ operation: "c" }));
    expect(diagnostics.recent().map((e) => e.operation)).toEqual(["b", "c"]);
  });
});

describe("CapabilityMetrics", () => {
  it("aggregates invocations/failures and computes average duration", () => {
    const metrics = new CapabilityMetrics();
    metrics.record(outcome({ ok: true, durationMs: 10 }));
    metrics.record(outcome({ ok: false, durationMs: 20 }));
    const snapshot = metrics.snapshot("notifications");
    expect(snapshot).toEqual({
      domain: "notifications",
      invocations: 2,
      failures: 1,
      averageDurationMs: 15,
    });
  });

  it("returns undefined for a domain with no recorded invocations", () => {
    expect(new CapabilityMetrics().snapshot("never-called")).toBeUndefined();
  });

  it("lists all snapshots", () => {
    const metrics = new CapabilityMetrics();
    metrics.record(outcome({ domain: "a" }));
    metrics.record(outcome({ domain: "b" }));
    expect(metrics.allSnapshots()).toHaveLength(2);
  });
});
