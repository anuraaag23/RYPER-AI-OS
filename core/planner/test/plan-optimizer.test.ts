import { describe, expect, it } from "vitest";
import { PlanOptimizer, dedupeTasks, reduceRedundantDependencies } from "../src/plan-optimizer.js";
import type { TaskNode } from "../src/types.js";

function task(id: string, overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id,
    taskType: "ai",
    operation: "respond",
    description: id,
    parameters: {},
    dependsOn: [],
    priority: "normal",
    ...overrides,
  };
}

describe("dedupeTasks", () => {
  it("collapses two identical tasks into one and rewires dependents", () => {
    const tasks = [
      task("a", { operation: "check_email" }),
      task("b", { operation: "check_email" }),
      task("c", { dependsOn: ["b"] }),
    ];
    const result = dedupeTasks(tasks);
    expect(result).toHaveLength(2);
    const kept = result.find((t) => t.operation === "check_email");
    const c = result.find((t) => t.id === "c");
    expect(c?.dependsOn).toEqual([kept?.id]);
  });

  it("leaves distinct tasks untouched", () => {
    const tasks = [task("a", { operation: "x" }), task("b", { operation: "y" })];
    expect(dedupeTasks(tasks)).toEqual(tasks);
  });
});

describe("reduceRedundantDependencies", () => {
  it("drops a dependency that is already implied transitively", () => {
    // c depends on a and b, but b already depends on a -> "a" is redundant on c.
    const tasks = [
      task("a"),
      task("b", { dependsOn: ["a"] }),
      task("c", { dependsOn: ["a", "b"] }),
    ];
    const result = reduceRedundantDependencies(tasks);
    const c = result.find((t) => t.id === "c");
    expect(c?.dependsOn).toEqual(["b"]);
  });

  it("leaves genuinely independent dependencies alone", () => {
    const tasks = [task("a"), task("b"), task("c", { dependsOn: ["a", "b"] })];
    const result = reduceRedundantDependencies(tasks);
    const c = result.find((t) => t.id === "c");
    expect(new Set(c?.dependsOn)).toEqual(new Set(["a", "b"]));
  });
});

describe("PlanOptimizer", () => {
  it("dedupes then reduces in one pass", () => {
    const tasks = [
      task("a"),
      task("b", { dependsOn: ["a"] }),
      task("dupe-b", { dependsOn: ["a"] }), // duplicate of b: same type/op/params/deps
      task("c", { dependsOn: ["a", "b", "dupe-b"] }),
    ];
    const optimized = new PlanOptimizer().optimize(tasks);
    const ids = optimized.map((t) => t.id);
    expect(ids).not.toContain("dupe-b");
    const c = optimized.find((t) => t.id === "c");
    expect(c?.dependsOn).toEqual(["b"]);
  });
});
