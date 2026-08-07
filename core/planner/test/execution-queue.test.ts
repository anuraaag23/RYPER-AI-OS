import { describe, expect, it } from "vitest";
import { TaskGraph, computeExecutionLevels } from "../src/dependency-analyzer.js";
import {
  ExecutionQueue,
  ParallelExecutionPlanner,
  SequentialExecutionPlanner,
} from "../src/execution-queue.js";
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

describe("ParallelExecutionPlanner / SequentialExecutionPlanner", () => {
  const tasks = [
    task("a", { priority: "low" }),
    task("b", { priority: "critical" }),
    task("c", { dependsOn: ["a", "b"] }),
  ];
  const graph = new TaskGraph(tasks);
  const levels = computeExecutionLevels(graph);

  it("groups level-0 tasks by priority descending", () => {
    const groups = new ParallelExecutionPlanner().planGroups(graph, levels);
    expect(groups[0]?.map((t) => t.id)).toEqual(["b", "a"]);
    expect(groups[1]?.map((t) => t.id)).toEqual(["c"]);
  });

  it("flattens levels into one priority-ordered sequence", () => {
    const order = new SequentialExecutionPlanner().planOrder(graph, levels);
    expect(order.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });
});

describe("ExecutionQueue", () => {
  it("only surfaces tasks whose dependencies have succeeded", () => {
    const graph = new TaskGraph([task("a"), task("b", { dependsOn: ["a"] })]);
    const queue = new ExecutionQueue(graph);

    const firstReady = queue.dequeueReady();
    expect(firstReady.map((t) => t.id)).toEqual(["a"]);
    expect(queue.dequeueReady()).toHaveLength(0); // "a" already moved to "ready", not re-emitted

    queue.markRunning("a");
    queue.markSucceeded("a", { ok: true });

    const secondReady = queue.dequeueReady();
    expect(secondReady.map((t) => t.id)).toEqual(["b"]);
    expect(queue.isComplete()).toBe(false);

    queue.markRunning("b");
    queue.markSucceeded("b");
    expect(queue.isComplete()).toBe(true);
  });

  it("marks a task failed and still reports plan completion once nothing else is pending", () => {
    const graph = new TaskGraph([task("a")]);
    const queue = new ExecutionQueue(graph);
    queue.dequeueReady();
    queue.markRunning("a");
    queue.markFailed("a", "boom");
    expect(queue.getStatus("a")?.state).toBe("failed");
    expect(queue.getStatus("a")?.error).toBe("boom");
    expect(queue.isComplete()).toBe(true);
  });

  it("skips a task whose condition is not satisfied", () => {
    const graph = new TaskGraph([
      task("a"),
      task("b", {
        dependsOn: ["a"],
        condition: { dependsOnTaskId: "a", expression: "on_failure" },
      }),
    ]);
    const queue = new ExecutionQueue(graph);
    queue.dequeueReady();
    queue.markRunning("a");
    queue.markSucceeded("a");

    const ready = queue.dequeueReady();
    expect(ready).toHaveLength(0);
    expect(queue.getStatus("b")?.state).toBe("skipped");
    expect(queue.isComplete()).toBe(true);
  });

  it("cancels all pending/ready tasks and stops surfacing new ready work", () => {
    const graph = new TaskGraph([task("a"), task("b")]);
    const queue = new ExecutionQueue(graph);
    queue.cancel();
    expect(queue.dequeueReady()).toHaveLength(0);
    expect(queue.getStatus("a")?.state).toBe("cancelled");
    expect(queue.getStatus("b")?.state).toBe("cancelled");
  });

  it("throws when marking an unknown task id", () => {
    const graph = new TaskGraph([task("a")]);
    const queue = new ExecutionQueue(graph);
    expect(() => queue.markRunning("missing")).toThrow();
  });
});
