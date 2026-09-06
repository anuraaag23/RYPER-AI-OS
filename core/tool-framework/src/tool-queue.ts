import { createSystemSchedulerBackend, type SchedulerBackend } from "@ryper/planner";
import type { ToolInvocationRequest, ToolResult } from "./types.js";

const PRIORITY_WEIGHT: Readonly<Record<NonNullable<ToolInvocationRequest["priority"]>, number>> = {
  critical: 3,
  high: 2,
  normal: 1,
  low: 0,
};

interface QueueEntry {
  readonly request: ToolInvocationRequest;
  readonly run: () => Promise<ToolResult>;
  readonly resolve: (result: ToolResult) => void;
  readonly reject: (err: unknown) => void;
}

/**
 * Bounds how many tool invocations run concurrently. Requests beyond the
 * concurrency limit wait in a priority-ordered queue rather than firing
 * immediately — the same "resource-aware scheduling" concern
 * `@ryper/planner`'s brief calls out, applied at the tool-execution layer
 * instead of the plan-building layer.
 */
export class ToolQueue {
  private readonly pending: QueueEntry[] = [];
  private active = 0;

  constructor(private readonly maxConcurrent = 4) {}

  enqueue(request: ToolInvocationRequest, run: () => Promise<ToolResult>): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve, reject) => {
      this.pending.push({ request, run, resolve, reject });
      this.pending.sort(
        (a, b) =>
          PRIORITY_WEIGHT[b.request.priority ?? "normal"] -
          PRIORITY_WEIGHT[a.request.priority ?? "normal"],
      );
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.pending.length > 0) {
      const entry = this.pending.shift();
      if (!entry) break;
      this.active += 1;
      entry
        .run()
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }

  size(): number {
    return this.pending.length;
  }

  activeCount(): number {
    return this.active;
  }
}

export function createToolQueue(maxConcurrent?: number): ToolQueue {
  return new ToolQueue(maxConcurrent);
}

/**
 * Defers a single tool invocation to a future time or after a delay.
 * Built directly on `@ryper/planner`'s `SchedulerBackend` contract rather
 * than a second clock/timer abstraction — the same interface, a different
 * (non-recurring, single-invocation) caller.
 */
export class ToolScheduler {
  constructor(private readonly backend: SchedulerBackend = createSystemSchedulerBackend()) {}

  scheduleAt(at: Date, task: () => void): void {
    this.backend.scheduleAt(at, task);
  }

  scheduleDelayed(delayMs: number, task: () => void): void {
    const at = new Date(this.backend.now().getTime() + delayMs);
    this.backend.scheduleAt(at, task);
  }
}

export function createToolScheduler(backend?: SchedulerBackend): ToolScheduler {
  return new ToolScheduler(backend);
}
