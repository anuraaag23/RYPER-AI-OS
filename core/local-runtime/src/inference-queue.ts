import { createLogger } from "@ryper/logging";

const log = createLogger("local-runtime:inference-queue");

export interface QueueTaskOptions {
  /** Higher runs first among currently-queued tasks. Default 0. */
  readonly priority?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

export class QueueTimeoutError extends Error {}
export class QueueCancelledError extends Error {}

interface QueueEntry<T> {
  readonly run: () => Promise<T>;
  readonly priority: number;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number | undefined;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

/**
 * Serves the Runtime Scheduler, Inference Queue, and Concurrent Request
 * Manager responsibilities together: it's one bounded-concurrency,
 * priority-ordered queue, which is what all three amount to for a local
 * inference runtime. Cancellation via `signal` stops the *queue* from
 * waiting on a task's result once aborted; it does not forcibly kill
 * in-flight native inference (JavaScript can't do that generically) — a
 * runtime provider adapter that wraps a killable process should honor
 * `signal` itself for a true hard-stop.
 */
export class InferenceQueue {
  private readonly queue: Array<QueueEntry<unknown>> = [];
  private runningCount = 0;

  constructor(private readonly maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new Error("maxConcurrent must be at least 1");
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get running(): number {
    return this.runningCount;
  }

  enqueue<T>(run: () => Promise<T>, options: QueueTaskOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new QueueCancelledError("task was already cancelled before it was queued"));
        return;
      }

      const entry: QueueEntry<T> = {
        run,
        priority: options.priority ?? 0,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        resolve,
        reject,
      };
      this.queue.push(entry as QueueEntry<unknown>);
      this.queue.sort((a, b) => b.priority - a.priority);
      this.drain();
    });
  }

  private drain(): void {
    while (this.runningCount < this.maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry) break;
      void this.runOne(entry);
    }
  }

  private async runOne(entry: QueueEntry<unknown>): Promise<void> {
    if (entry.signal?.aborted) {
      entry.reject(new QueueCancelledError("task was cancelled before it started running"));
      return;
    }

    this.runningCount += 1;
    try {
      const result = await this.raceWithControls(entry);
      entry.resolve(result);
    } catch (err) {
      entry.reject(err);
    } finally {
      this.runningCount -= 1;
      this.drain();
    }
  }

  private raceWithControls(entry: QueueEntry<unknown>): Promise<unknown> {
    const racers: Promise<unknown>[] = [entry.run()];

    if (entry.timeoutMs !== undefined) {
      racers.push(
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new QueueTimeoutError(`task exceeded ${entry.timeoutMs}ms`)),
            entry.timeoutMs,
          );
        }),
      );
    }

    if (entry.signal) {
      racers.push(
        new Promise((_, reject) => {
          entry.signal?.addEventListener(
            "abort",
            () => reject(new QueueCancelledError("task was cancelled")),
            {
              once: true,
            },
          );
        }),
      );
    }

    return Promise.race(racers);
  }

  /** Diagnostic snapshot, useful for a resource-monitoring UI. */
  stats(): { pending: number; running: number; maxConcurrent: number } {
    return { pending: this.pending, running: this.running, maxConcurrent: this.maxConcurrent };
  }
}

export function createInferenceQueue(maxConcurrent: number): InferenceQueue {
  log.info("inference queue created", { maxConcurrent });
  return new InferenceQueue(maxConcurrent);
}
