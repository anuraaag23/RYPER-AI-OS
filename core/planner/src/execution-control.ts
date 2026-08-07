import type { EventBus } from "@ryper/event-bus";
import type { ExecutionQueue } from "./execution-queue.js";
import type { TaskRuntimeStatus } from "./types.js";

const SOURCE = "planner";

/**
 * Owns one `AbortController` per running plan and propagates cancellation
 * to both the queue (so no further tasks become "ready") and any
 * `AbortSignal`-aware handler already in flight for the current task.
 */
export class CancellationManager {
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly eventBus?: EventBus) {}

  begin(planId: string): AbortSignal {
    const controller = new AbortController();
    this.controllers.set(planId, controller);
    return controller.signal;
  }

  async cancel(
    planId: string,
    queue: ExecutionQueue,
    reason = "user requested cancellation",
  ): Promise<void> {
    const controller = this.controllers.get(planId);
    controller?.abort(reason);
    queue.cancel();
    await this.eventBus?.emit("planner.plan.cancelled", { planId, reason }, SOURCE);
  }

  isCancelled(planId: string): boolean {
    return this.controllers.get(planId)?.signal.aborted ?? false;
  }

  dispose(planId: string): void {
    this.controllers.delete(planId);
  }
}

export function createCancellationManager(eventBus?: EventBus): CancellationManager {
  return new CancellationManager(eventBus);
}

export interface PlanProgress {
  readonly planId: string;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly percent: number;
}

function summarize(planId: string, statuses: readonly TaskRuntimeStatus[]): PlanProgress {
  const total = statuses.length;
  const completed = statuses.filter((s) => s.state === "succeeded" || s.state === "skipped").length;
  const failed = statuses.filter((s) => s.state === "failed").length;
  const finished = statuses.filter((s) =>
    ["succeeded", "failed", "cancelled", "skipped"].includes(s.state),
  ).length;
  return {
    planId,
    total,
    completed,
    failed,
    percent: total === 0 ? 100 : Math.round((finished / total) * 100),
  };
}

/**
 * Emits `planner.task.*` and `planner.plan.progress` events over the
 * shared `EventBus` as an `ExecutionQueue`'s tasks complete, so UI
 * surfaces and automation rules can react without polling.
 */
export class ProgressTracker {
  constructor(private readonly eventBus?: EventBus) {}

  async reportTaskStarted(planId: string, taskId: string): Promise<void> {
    await this.eventBus?.emit("planner.task.started", { planId, taskId }, SOURCE);
  }

  async reportTaskFinished(
    planId: string,
    taskId: string,
    status: TaskRuntimeStatus,
  ): Promise<void> {
    const type = status.state === "succeeded" ? "planner.task.succeeded" : "planner.task.failed";
    await this.eventBus?.emit(type, { planId, taskId, status }, SOURCE);
  }

  async reportProgress(planId: string, queue: ExecutionQueue): Promise<PlanProgress> {
    const progress = summarize(planId, queue.snapshot());
    await this.eventBus?.emit("planner.plan.progress", progress, SOURCE);
    return progress;
  }
}

export function createProgressTracker(eventBus?: EventBus): ProgressTracker {
  return new ProgressTracker(eventBus);
}
