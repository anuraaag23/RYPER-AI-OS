import { describe, expect, it } from "vitest";
import { RecoveryPlanner, RetryPlanner } from "../src/retry-recovery.js";
import type { CapabilityResolution, TaskNode } from "../src/types.js";

function task(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "t1",
    taskType: "browser",
    operation: "navigate",
    description: "navigate somewhere",
    parameters: {},
    dependsOn: [],
    priority: "normal",
    ...overrides,
  };
}

describe("RetryPlanner", () => {
  const planner = new RetryPlanner();

  it("gives a retryable task type multiple attempts", () => {
    const policy = planner.plan(task({ taskType: "browser" }));
    expect(policy.maxAttempts).toBe(3);
  });

  it("gives a one-shot task type a single attempt", () => {
    const policy = planner.plan(task({ taskType: "note", operation: "create" }));
    expect(policy.maxAttempts).toBe(1);
  });

  it("respects an already-assigned retry policy", () => {
    const explicit = { maxAttempts: 9, backoffMs: 1, backoffMultiplier: 1 };
    const policy = planner.plan(task({ retryPolicy: explicit }));
    expect(policy).toBe(explicit);
  });

  it("applies retry policies across a task list", () => {
    const tasks = planner.apply([
      task({ id: "a" }),
      task({ id: "b", taskType: "note", operation: "create" }),
    ]);
    expect(tasks[0]?.retryPolicy?.maxAttempts).toBe(3);
    expect(tasks[1]?.retryPolicy?.maxAttempts).toBe(1);
  });
});

describe("RecoveryPlanner", () => {
  const planner = new RecoveryPlanner();

  it("attaches a fallback AI task for an unsupported task", () => {
    const resolution: CapabilityResolution = {
      taskType: "call",
      supported: false,
      alternative: "calls aren't supported here",
    };
    const step = planner.planForUnsupported(task({ taskType: "call" }), resolution);
    expect(step.continueOnSuccess).toBe(true);
    expect(step.fallbackTask?.taskType).toBe("ai");
    expect(step.fallbackTask?.parameters["prompt"]).toBe("calls aren't supported here");
  });

  it("gives a capability-gated but supported task a rollback note, not a fallback task", () => {
    const step = planner.planRollback(task({ requiredCapability: "network" }));
    expect(step.fallbackTask).toBeUndefined();
    expect(step.continueOnSuccess).toBe(false);
  });

  it("applies recovery across a task list based on resolutions", () => {
    const resolutions: readonly CapabilityResolution[] = [
      { taskType: "call", supported: false, alternative: "no calls here" },
      { taskType: "browser", supported: true, requiredCapability: "network" },
    ];
    const tasks = planner.apply(
      [
        task({ id: "a", taskType: "call" }),
        task({ id: "b", taskType: "browser", requiredCapability: "network" }),
      ],
      resolutions,
    );
    expect(tasks[0]?.recovery?.fallbackTask).toBeDefined();
    expect(tasks[1]?.recovery?.fallbackTask).toBeUndefined();
    expect(tasks[1]?.recovery?.continueOnSuccess).toBe(false);
  });

  it("leaves a task with no capability and a supported resolution untouched", () => {
    const resolutions: readonly CapabilityResolution[] = [{ taskType: "note", supported: true }];
    const tasks = planner.apply(
      [task({ id: "a", taskType: "note", operation: "create" })],
      resolutions,
    );
    expect(tasks[0]?.recovery).toBeUndefined();
  });
});
