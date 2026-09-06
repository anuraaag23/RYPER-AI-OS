import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { TaskGraph } from "../src/dependency-analyzer.js";
import { ExecutionQueue } from "../src/execution-queue.js";
import { CancellationManager, ProgressTracker } from "../src/execution-control.js";
import type { TaskNode } from "../src/types.js";

function task(id: string, dependsOn: readonly string[] = []): TaskNode {
  return {
    id,
    taskType: "ai",
    operation: "respond",
    description: id,
    parameters: {},
    dependsOn,
    priority: "normal",
  };
}

describe("CancellationManager", () => {
  it("aborts the plan's signal and cancels the queue", async () => {
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe({ type: "planner.plan.cancelled" }, (event) => events.push(event.payload));

    const manager = new CancellationManager(bus);
    const signal = manager.begin("plan-1");
    expect(signal.aborted).toBe(false);

    const queue = new ExecutionQueue(new TaskGraph([task("a")]));
    await manager.cancel("plan-1", queue, "test reason");

    expect(signal.aborted).toBe(true);
    expect(queue.getStatus("a")?.state).toBe("cancelled");
    expect(events).toEqual([{ planId: "plan-1", reason: "test reason" }]);
    expect(manager.isCancelled("plan-1")).toBe(true);
  });

  it("reports not cancelled for a plan that was never begun", () => {
    const manager = new CancellationManager();
    expect(manager.isCancelled("never-started")).toBe(false);
  });

  it("works without an event bus", async () => {
    const manager = new CancellationManager();
    manager.begin("plan-1");
    const queue = new ExecutionQueue(new TaskGraph([task("a")]));
    await expect(manager.cancel("plan-1", queue)).resolves.toBeUndefined();
  });
});

describe("ProgressTracker", () => {
  it("emits started/succeeded events and computes overall progress", async () => {
    const bus = new EventBus();
    const events: string[] = [];
    bus.subscribe({ type: "planner.task.started" }, () => events.push("started"));
    bus.subscribe({ type: "planner.task.succeeded" }, () => events.push("succeeded"));
    bus.subscribe({ type: "planner.plan.progress" }, () => events.push("progress"));

    const tracker = new ProgressTracker(bus);
    const graph = new TaskGraph([task("a"), task("b", ["a"])]);
    const queue = new ExecutionQueue(graph);

    queue.dequeueReady();
    await tracker.reportTaskStarted("plan-1", "a");
    queue.markRunning("a");
    queue.markSucceeded("a");
    await tracker.reportTaskFinished("plan-1", "a", queue.getStatus("a")!);

    const progress = await tracker.reportProgress("plan-1", queue);
    expect(progress.completed).toBe(1);
    expect(progress.total).toBe(2);
    expect(progress.percent).toBe(50);
    expect(events).toEqual(["started", "succeeded", "progress"]);
  });

  it("reports 100 percent for an empty plan", async () => {
    const tracker = new ProgressTracker();
    const queue = new ExecutionQueue(new TaskGraph([]));
    const progress = await tracker.reportProgress("plan-1", queue);
    expect(progress.percent).toBe(100);
  });
});
