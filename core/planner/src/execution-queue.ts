import type { TaskGraph } from "./dependency-analyzer.js";
import type { TaskExecutionState, TaskNode, TaskRuntimeStatus } from "./types.js";

const PRIORITY_WEIGHT: Readonly<Record<TaskNode["priority"], number>> = {
  critical: 3,
  high: 2,
  normal: 1,
  low: 0,
};

function byPriorityDesc(a: TaskNode, b: TaskNode): number {
  return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
}

/** Groups tasks into their DAG execution levels, each level's tasks safe to run concurrently. */
export class ParallelExecutionPlanner {
  planGroups(
    graph: TaskGraph,
    levels: readonly (readonly string[])[],
  ): readonly (readonly TaskNode[])[] {
    return levels.map((level) =>
      level
        .map((id) => graph.getNode(id))
        .filter((task): task is TaskNode => task !== undefined)
        .sort(byPriorityDesc),
    );
  }
}

export function createParallelExecutionPlanner(): ParallelExecutionPlanner {
  return new ParallelExecutionPlanner();
}

/** Flattens execution levels into one priority-ordered sequential run order. */
export class SequentialExecutionPlanner {
  planOrder(graph: TaskGraph, levels: readonly (readonly string[])[]): readonly TaskNode[] {
    const ordered: TaskNode[] = [];
    for (const level of levels) {
      const tasks = level
        .map((id) => graph.getNode(id))
        .filter((task): task is TaskNode => task !== undefined)
        .sort(byPriorityDesc);
      ordered.push(...tasks);
    }
    return ordered;
  }
}

export function createSequentialExecutionPlanner(): SequentialExecutionPlanner {
  return new SequentialExecutionPlanner();
}

/**
 * The only three condition keywords this reference implementation
 * understands. A `TaskCondition.expression` outside this set is treated
 * as unmet (the safe default) — real predicate evaluation against live
 * device/app state is future work for whichever platform agent owns that
 * state, not something the planner can honestly evaluate on its own.
 */
function evaluateCondition(
  expression: string,
  upstreamState: TaskExecutionState | undefined,
): boolean {
  switch (expression.trim().toLowerCase()) {
    case "always":
      return true;
    case "on_success":
      return upstreamState === "succeeded";
    case "on_failure":
      return upstreamState === "failed";
    default:
      return false;
  }
}

/**
 * Tracks per-task runtime state for one execution plan and exposes the
 * currently-runnable task set as dependencies complete. This is the data
 * structure a future platform agent drives via `dequeueReady()` /
 * `markSucceeded()` / `markFailed()` — the planner never calls these
 * itself, it only hands the queue to whoever is executing the plan.
 */
export class ExecutionQueue {
  private readonly statuses = new Map<string, TaskRuntimeStatus>();
  private cancelled = false;

  constructor(private readonly graph: TaskGraph) {
    for (const task of graph.listNodes()) {
      this.statuses.set(task.id, { taskId: task.id, state: "pending", attempts: 0 });
    }
  }

  private dependenciesSatisfied(task: TaskNode): boolean {
    return task.dependsOn.every((dep) => this.statuses.get(dep)?.state === "succeeded");
  }

  private conditionSatisfied(task: TaskNode): boolean {
    if (!task.condition) return true;
    const upstream = this.statuses.get(task.condition.dependsOnTaskId)?.state;
    return evaluateCondition(task.condition.expression, upstream);
  }

  /** Every task whose dependencies (and condition, if any) are satisfied and hasn't started. */
  dequeueReady(): readonly TaskNode[] {
    if (this.cancelled) return [];
    const ready: TaskNode[] = [];
    for (const task of this.graph.listNodes()) {
      const status = this.statuses.get(task.id);
      if (status?.state !== "pending") continue;
      if (!this.dependenciesSatisfied(task)) continue;
      if (!this.conditionSatisfied(task)) {
        this.statuses.set(task.id, { ...status, state: "skipped" });
        continue;
      }
      ready.push(task);
      this.statuses.set(task.id, { ...status, state: "ready" });
    }
    return ready.sort(byPriorityDesc);
  }

  markRunning(taskId: string): void {
    const status = this.mustGet(taskId);
    this.statuses.set(taskId, {
      ...status,
      state: "running",
      attempts: status.attempts + 1,
      startedAt: new Date().toISOString(),
    });
  }

  markSucceeded(taskId: string, result?: unknown): void {
    const status = this.mustGet(taskId);
    this.statuses.set(taskId, {
      ...status,
      state: "succeeded",
      finishedAt: new Date().toISOString(),
      ...(result !== undefined ? { result } : {}),
    });
  }

  markFailed(taskId: string, error: string): void {
    const status = this.mustGet(taskId);
    this.statuses.set(taskId, {
      ...status,
      state: "failed",
      finishedAt: new Date().toISOString(),
      error,
    });
  }

  cancel(): void {
    this.cancelled = true;
    for (const [taskId, status] of this.statuses) {
      if (status.state === "pending" || status.state === "ready") {
        this.statuses.set(taskId, { ...status, state: "cancelled" });
      }
    }
  }

  isComplete(): boolean {
    return [...this.statuses.values()].every((status) =>
      ["succeeded", "failed", "cancelled", "skipped"].includes(status.state),
    );
  }

  getStatus(taskId: string): TaskRuntimeStatus | undefined {
    return this.statuses.get(taskId);
  }

  snapshot(): readonly TaskRuntimeStatus[] {
    return [...this.statuses.values()];
  }

  private mustGet(taskId: string): TaskRuntimeStatus {
    const status = this.statuses.get(taskId);
    if (!status) throw new Error(`unknown task id "${taskId}"`);
    return status;
  }
}

export function createExecutionQueue(graph: TaskGraph): ExecutionQueue {
  return new ExecutionQueue(graph);
}
