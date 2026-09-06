import { describe, expect, it } from "vitest";
import { ExecutionQueue, TaskGraph } from "@ryper/planner";
import type { ExecutionPlan, TaskNode } from "@ryper/planner";
import { PlannerToolBridge } from "../src/planner-integration.js";
import type { ToolInvoker } from "../src/voice-integration.js";
import type { ToolResult } from "../src/types.js";

function task(
  id: string,
  taskType: string,
  operation: string,
  dependsOn: readonly string[] = [],
): TaskNode {
  return {
    id,
    taskType: taskType as TaskNode["taskType"],
    operation,
    description: id,
    parameters: {},
    dependsOn,
    priority: "normal",
  };
}

function plan(tasks: readonly TaskNode[]): ExecutionPlan {
  return {
    id: "plan-1",
    tasks,
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

function okResult(toolId: string, value: unknown = { ok: true }): ToolResult {
  return {
    invocationId: `inv-${toolId}`,
    toolId,
    status: "ok",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    attempts: 1,
    value,
  };
}

describe("PlannerToolBridge", () => {
  it("routes a TaskNode to its registered tool and marks the queue task succeeded", async () => {
    const invoker: ToolInvoker = { invoke: async (toolId) => okResult(toolId) };
    const bridge = new PlannerToolBridge(invoker);
    bridge.registerRoute("application", "open", "desktop.open_application");

    const t = task("t1", "application", "open");
    expect(bridge.routeFor(t)).toBe("desktop.open_application");

    const p = plan([t]);
    const queue = new ExecutionQueue(new TaskGraph(p.tasks));
    await bridge.runToCompletion(queue, p, "actor-1", "session-1", "windows");

    expect(queue.getStatus("t1")?.state).toBe("succeeded");
    expect(queue.getStatus("t1")?.result).toEqual({ ok: true });
  });

  it("marks a task failed when no tool route is registered", async () => {
    const invoker: ToolInvoker = { invoke: async (toolId) => okResult(toolId) };
    const bridge = new PlannerToolBridge(invoker);
    const p = plan([task("t1", "browser", "navigate")]);
    const queue = new ExecutionQueue(new TaskGraph(p.tasks));
    await bridge.runToCompletion(queue, p, "actor-1", "session-1", "windows");
    expect(queue.getStatus("t1")?.state).toBe("failed");
    expect(queue.getStatus("t1")?.error).toContain("no tool route registered");
  });

  it("marks a task failed when the invoked tool itself fails", async () => {
    const invoker: ToolInvoker = {
      invoke: async (toolId) => ({
        invocationId: "i1",
        toolId,
        status: "error",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
        attempts: 1,
        errorMessage: "boom",
      }),
    };
    const bridge = new PlannerToolBridge(invoker);
    bridge.registerRoute("browser", "navigate", "browser.navigate");
    const p = plan([task("t1", "browser", "navigate")]);
    const queue = new ExecutionQueue(new TaskGraph(p.tasks));
    await bridge.runToCompletion(queue, p, "actor-1", "session-1", "windows");
    expect(queue.getStatus("t1")?.state).toBe("failed");
    expect(queue.getStatus("t1")?.error).toBe("boom");
  });

  it("drives a multi-task dependency chain to full completion", async () => {
    const order: string[] = [];
    const invoker: ToolInvoker = {
      invoke: async (toolId) => {
        order.push(toolId);
        return okResult(toolId);
      },
    };
    const bridge = new PlannerToolBridge(invoker);
    bridge.registerRoute("application", "open", "desktop.open_application");
    bridge.registerRoute("audio", "set_volume", "media.set_volume");

    const t1 = task("t1", "application", "open");
    const t2 = task("t2", "audio", "set_volume", ["t1"]);
    const p = plan([t1, t2]);
    const queue = new ExecutionQueue(new TaskGraph(p.tasks));
    await bridge.runToCompletion(queue, p, "actor-1", "session-1", "windows");

    expect(queue.isComplete()).toBe(true);
    expect(order).toEqual(["desktop.open_application", "media.set_volume"]);
  });
});
