import type { TaskNode } from "./types.js";

function signature(task: TaskNode): string {
  return JSON.stringify({
    taskType: task.taskType,
    operation: task.operation,
    parameters: task.parameters,
    dependsOn: [...task.dependsOn].sort(),
  });
}

/**
 * Collapses tasks that are exact duplicates (same type, operation,
 * parameters, and dependencies) into one, rewiring anything that
 * depended on a removed duplicate to depend on the kept task instead.
 * This is the case a naive multi-clause request produces, e.g. "check
 * email and check my email" generating the same task twice.
 */
export function dedupeTasks(tasks: readonly TaskNode[]): readonly TaskNode[] {
  const keptBySignature = new Map<string, TaskNode>();
  const remap = new Map<string, string>();

  for (const task of tasks) {
    const sig = signature(task);
    const existing = keptBySignature.get(sig);
    if (existing) {
      remap.set(task.id, existing.id);
    } else {
      keptBySignature.set(sig, task);
    }
  }

  if (remap.size === 0) return tasks;

  const resolve = (id: string): string => remap.get(id) ?? id;
  return [...keptBySignature.values()].map((task) => ({
    ...task,
    dependsOn: [...new Set(task.dependsOn.map(resolve))].filter((dep) => dep !== task.id),
    ...(task.condition
      ? {
          condition: {
            ...task.condition,
            dependsOnTaskId: resolve(task.condition.dependsOnTaskId),
          },
        }
      : {}),
  }));
}

/**
 * Removes dependency edges that are already implied transitively, so the
 * Dependency Analyzer can place tasks in the earliest execution level
 * their *real* constraints allow. E.g. if C depends on both A and B, and
 * B already depends on A, then "C depends on A" is redundant — C only
 * needs to wait for B, which itself already waits for A.
 */
export function reduceRedundantDependencies(tasks: readonly TaskNode[]): readonly TaskNode[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const reachable = new Map<string, Set<string>>();

  const computeReachable = (id: string, seen = new Set<string>()): Set<string> => {
    const cached = reachable.get(id);
    if (cached) return cached;
    if (seen.has(id)) return new Set(); // defensive: a cycle here is reported elsewhere
    seen.add(id);
    const result = new Set<string>();
    const task = byId.get(id);
    for (const dep of task?.dependsOn ?? []) {
      result.add(dep);
      for (const transitive of computeReachable(dep, seen)) {
        result.add(transitive);
      }
    }
    reachable.set(id, result);
    return result;
  };

  return tasks.map((task) => {
    if (task.dependsOn.length <= 1) return task;
    const directReachableViaOthers = new Set<string>();
    for (const dep of task.dependsOn) {
      for (const transitive of computeReachable(dep)) {
        directReachableViaOthers.add(transitive);
      }
    }
    const reduced = task.dependsOn.filter((dep) => !directReachableViaOthers.has(dep));
    return reduced.length === task.dependsOn.length ? task : { ...task, dependsOn: reduced };
  });
}

/**
 * Runs the full optimization pass the Planner Engine applies to every
 * generated task list before dependency analysis: dedupe first (so the
 * transitive reduction operates on the smallest possible graph), then
 * transitive reduction to unlock maximum safe parallelism.
 */
export class PlanOptimizer {
  optimize(tasks: readonly TaskNode[]): readonly TaskNode[] {
    return reduceRedundantDependencies(dedupeTasks(tasks));
  }
}

export function createPlanOptimizer(): PlanOptimizer {
  return new PlanOptimizer();
}
