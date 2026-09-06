import type { CapabilityResolution } from "./types.js";
import type { RecoveryStep, RetryPolicy, TaskNode, TaskType } from "./types.js";

const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 1, backoffMs: 500, backoffMultiplier: 2 };

/** Task types worth retrying automatically — network- or device-flaky operations. */
const RETRYABLE_TASK_TYPES = new Set<TaskType>(["browser", "cloud", "file", "smart_home", "ai"]);

/**
 * Attaches a `RetryPolicy` to every task that's worth retrying
 * automatically. Tasks that aren't (e.g. a one-shot `note.create`) keep
 * `maxAttempts: 1` so a downstream agent never silently repeats a
 * side-effecting action that failed for a non-transient reason.
 */
export class RetryPlanner {
  plan(task: TaskNode): RetryPolicy {
    if (task.retryPolicy) return task.retryPolicy;
    if (!RETRYABLE_TASK_TYPES.has(task.taskType)) return DEFAULT_RETRY;
    return { maxAttempts: 3, backoffMs: 500, backoffMultiplier: 2 };
  }

  apply(tasks: readonly TaskNode[]): readonly TaskNode[] {
    return tasks.map((task) => ({ ...task, retryPolicy: this.plan(task) }));
  }
}

export function createRetryPlanner(): RetryPlanner {
  return new RetryPlanner();
}

/**
 * Builds a graceful degradation step for a task the `CapabilityResolver`
 * flagged as unsupported on the current platform: rather than letting the
 * task fail unexpectedly at execution time, it gets a fallback
 * conversational task explaining the gap (the same honesty the voice
 * engine's `notYetImplementedHandler` uses for unimplemented commands).
 */
export class RecoveryPlanner {
  planForUnsupported(task: TaskNode, resolution: CapabilityResolution): RecoveryStep {
    const fallbackTask: TaskNode = {
      id: `${task.id}-fallback`,
      taskType: "ai",
      operation: "respond",
      description: `Explain that "${task.description}" isn't available yet on this platform.`,
      parameters: {
        prompt: resolution.alternative ?? `${task.description} is not supported here.`,
      },
      dependsOn: [],
      priority: task.priority,
    };
    return {
      description: resolution.alternative ?? "unsupported on this platform",
      fallbackTask,
      continueOnSuccess: true,
    };
  }

  /** A generic rollback note for a capability-gated task that partially executed before failing. */
  planRollback(task: TaskNode): RecoveryStep {
    return {
      description: `If "${task.description}" fails partway through, undo any partial side effects before continuing.`,
      continueOnSuccess: false,
    };
  }

  apply(
    tasks: readonly TaskNode[],
    resolutions: readonly CapabilityResolution[],
  ): readonly TaskNode[] {
    const byType = new Map(resolutions.map((r) => [r.taskType, r]));
    return tasks.map((task) => {
      if (task.recovery) return task;
      const resolution = byType.get(task.taskType);
      if (resolution && !resolution.supported) {
        return { ...task, recovery: this.planForUnsupported(task, resolution) };
      }
      if (task.requiredCapability) {
        return { ...task, recovery: this.planRollback(task) };
      }
      return task;
    });
  }
}

export function createRecoveryPlanner(): RecoveryPlanner {
  return new RecoveryPlanner();
}
