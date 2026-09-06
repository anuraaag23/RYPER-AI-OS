import { describe, expect, it } from "vitest";
import {
  PlannerConfigValidationError,
  PlannerDiagnostics,
  loadPlannerConfig,
} from "../src/config-diagnostics.js";
import type { ExecutionPlan } from "../src/types.js";

describe("loadPlannerConfig", () => {
  it("applies defaults when no env vars are set", () => {
    const config = loadPlannerConfig({});
    expect(config.logLevel).toBe("info");
    expect(config.maxParallelTasks).toBe(8);
    expect(config.memoryIntegrationEnabled).toBe(true);
  });

  it("reads overrides from env vars", () => {
    const config = loadPlannerConfig({
      RYPER_PLANNER_LOG_LEVEL: "debug",
      RYPER_PLANNER_MAX_PARALLEL_TASKS: "4",
      RYPER_PLANNER_MEMORY_INTEGRATION_ENABLED: "false",
    });
    expect(config.logLevel).toBe("debug");
    expect(config.maxParallelTasks).toBe(4);
    expect(config.memoryIntegrationEnabled).toBe(false);
  });

  it("throws on an invalid log level", () => {
    expect(() => loadPlannerConfig({ RYPER_PLANNER_LOG_LEVEL: "verbose" })).toThrow(
      PlannerConfigValidationError,
    );
  });

  it("throws on a non-positive numeric override", () => {
    expect(() => loadPlannerConfig({ RYPER_PLANNER_MAX_PARALLEL_TASKS: "-1" })).toThrow(
      PlannerConfigValidationError,
    );
  });
});

function plan(id: string): ExecutionPlan {
  return {
    id,
    tasks: [],
    executionLevels: [],
    metadata: {
      createdAt: new Date().toISOString(),
      sourceRequest: "test",
      platform: "windows",
      intentShape: "simple",
    },
    diagnostics: [],
  };
}

describe("PlannerDiagnostics", () => {
  it("records plan build metadata and computes an average", () => {
    const diagnostics = new PlannerDiagnostics(10);
    diagnostics.record(plan("p1"), 10, []);
    diagnostics.record(plan("p2"), 20, ["task-x"]);

    expect(diagnostics.totalPlansBuilt()).toBe(2);
    expect(diagnostics.averageBuildDurationMs()).toBe(15);
    expect(diagnostics.recentPlans()).toHaveLength(2);
    expect(diagnostics.recentPlans()[1]?.unresolvedTools).toEqual(["task-x"]);
  });

  it("evicts the oldest entry once the history size is exceeded", () => {
    const diagnostics = new PlannerDiagnostics(2);
    diagnostics.record(plan("p1"), 1, []);
    diagnostics.record(plan("p2"), 1, []);
    diagnostics.record(plan("p3"), 1, []);

    const ids = diagnostics.recentPlans().map((entry) => entry.planId);
    expect(ids).toEqual(["p2", "p3"]);
    expect(diagnostics.totalPlansBuilt()).toBe(3);
  });

  it("reports zero average when nothing has been recorded", () => {
    expect(new PlannerDiagnostics().averageBuildDurationMs()).toBe(0);
  });
});
