import { describe, expect, it } from "vitest";
import { InferenceQueue, QueueTimeoutError, QueueCancelledError } from "../src/inference-queue.js";

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe("InferenceQueue", () => {
  it("runs tasks up to the concurrency limit and queues the rest", async () => {
    const queue = new InferenceQueue(2);
    let maxObservedConcurrency = 0;
    let current = 0;

    const makeTask = () => async () => {
      current += 1;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, current);
      await delay(undefined, 20);
      current -= 1;
      return "done";
    };

    await Promise.all([
      queue.enqueue(makeTask()),
      queue.enqueue(makeTask()),
      queue.enqueue(makeTask()),
    ]);
    expect(maxObservedConcurrency).toBeLessThanOrEqual(2);
  });

  it("rejects immediately for a signal that's already aborted", async () => {
    const queue = new InferenceQueue(1);
    const controller = new AbortController();
    controller.abort();
    await expect(queue.enqueue(async () => "x", { signal: controller.signal })).rejects.toThrow(
      QueueCancelledError,
    );
  });

  it("rejects a task that exceeds its timeout", async () => {
    const queue = new InferenceQueue(1);
    await expect(queue.enqueue(() => delay("too slow", 50), { timeoutMs: 10 })).rejects.toThrow(
      QueueTimeoutError,
    );
  });

  it("resolves a task that finishes within its timeout", async () => {
    const queue = new InferenceQueue(1);
    await expect(queue.enqueue(() => delay("fast enough", 5), { timeoutMs: 50 })).resolves.toBe(
      "fast enough",
    );
  });

  it("reports pending/running counts via stats()", async () => {
    const queue = new InferenceQueue(1);
    const first = queue.enqueue(() => delay("a", 20));
    const second = queue.enqueue(() => delay("b", 20));
    // Give the microtask queue a tick to start the first task.
    await Promise.resolve();
    const stats = queue.stats();
    expect(stats.running).toBe(1);
    expect(stats.pending).toBe(1);
    await Promise.all([first, second]);
  });

  it("continues draining the queue after one task fails", async () => {
    const queue = new InferenceQueue(1);
    const failing = queue.enqueue(async () => {
      throw new Error("boom");
    });
    const succeeding = queue.enqueue(async () => "ok");

    await expect(failing).rejects.toThrow("boom");
    await expect(succeeding).resolves.toBe("ok");
  });
});
