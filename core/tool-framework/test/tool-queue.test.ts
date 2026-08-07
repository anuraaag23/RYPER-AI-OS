import { describe, expect, it, vi } from "vitest";
import type { SchedulerBackend, SchedulerHandle } from "@ryper/planner";
import { ToolQueue, ToolScheduler } from "../src/tool-queue.js";
import type { ToolInvocationRequest, ToolResult } from "../src/types.js";

function request(overrides: Partial<ToolInvocationRequest> = {}): ToolInvocationRequest {
  return {
    toolId: "t1",
    parameters: {},
    actorId: "a",
    sessionId: "s",
    platform: "windows",
    ...overrides,
  };
}

function okResult(toolId: string): ToolResult {
  return {
    invocationId: `inv-${toolId}`,
    toolId,
    status: "ok",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    attempts: 1,
  };
}

describe("ToolQueue", () => {
  it("runs tasks immediately while under the concurrency limit", async () => {
    const queue = new ToolQueue(2);
    const order: string[] = [];
    const run = (id: string) => async () => {
      order.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 10));
      order.push(`end-${id}`);
      return okResult(id);
    };
    await Promise.all([
      queue.enqueue(request({ toolId: "a" }), run("a")),
      queue.enqueue(request({ toolId: "b" }), run("b")),
    ]);
    expect(order).toEqual(["start-a", "start-b", "end-a", "end-b"]);
  });

  it("queues extra work beyond the concurrency limit and runs it once capacity frees up", async () => {
    const queue = new ToolQueue(1);
    const order: string[] = [];
    const run = (id: string) => async () => {
      order.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 10));
      order.push(`end-${id}`);
      return okResult(id);
    };
    await Promise.all([
      queue.enqueue(request({ toolId: "a" }), run("a")),
      queue.enqueue(request({ toolId: "b" }), run("b")),
    ]);
    // with concurrency 1, "a" must fully finish before "b" starts
    expect(order).toEqual(["start-a", "end-a", "start-b", "end-b"]);
  });

  it("runs a higher-priority request before a lower-priority one queued earlier", async () => {
    const queue = new ToolQueue(1);
    const order: string[] = [];
    const blocker = new Promise<void>((resolve) => setTimeout(resolve, 20));
    const run = (id: string, waitFor?: Promise<void>) => async () => {
      if (waitFor) await waitFor;
      order.push(id);
      return okResult(id);
    };
    const first = queue.enqueue(request({ toolId: "blocker" }), run("blocker", blocker));
    const low = queue.enqueue(request({ toolId: "low", priority: "low" }), run("low"));
    const high = queue.enqueue(request({ toolId: "high", priority: "critical" }), run("high"));
    await Promise.all([first, low, high]);
    expect(order[0]).toBe("blocker");
    expect(order[1]).toBe("high");
    expect(order[2]).toBe("low");
  });

  it("reports size and activeCount", async () => {
    const queue = new ToolQueue(1);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const promise = queue.enqueue(request(), async () => {
      await gate;
      return okResult("t1");
    });
    queue.enqueue(request({ toolId: "t2" }), async () => okResult("t2"));
    expect(queue.activeCount()).toBe(1);
    expect(queue.size()).toBe(1);
    release();
    await promise;
  });
});

describe("ToolScheduler", () => {
  function fakeBackend(now: Date): { backend: SchedulerBackend; fire: () => void } {
    let callback: (() => void) | undefined;
    const backend: SchedulerBackend = {
      now: () => now,
      scheduleAt: (_at, cb): SchedulerHandle => {
        callback = cb;
        return { id: "t1" };
      },
      cancel: () => {
        callback = undefined;
      },
    };
    return { backend, fire: () => callback?.() };
  }

  it("schedules a task at an absolute time", () => {
    const { backend, fire } = fakeBackend(new Date("2026-07-20T06:00:00"));
    const scheduler = new ToolScheduler(backend);
    const task = vi.fn();
    scheduler.scheduleAt(new Date("2026-07-20T07:00:00"), task);
    fire();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("schedules a task after a delay relative to the backend's clock", () => {
    const { backend, fire } = fakeBackend(new Date("2026-07-20T06:00:00"));
    const scheduler = new ToolScheduler(backend);
    const task = vi.fn();
    scheduler.scheduleDelayed(60_000, task);
    fire();
    expect(task).toHaveBeenCalledTimes(1);
  });
});
