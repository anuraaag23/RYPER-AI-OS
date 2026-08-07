import type { TaskNode } from "./types.js";

export class GraphValidationError extends Error {}

/**
 * A Directed Acyclic Graph of `TaskNode`s. Construction validates that
 * every `dependsOn` reference resolves to a real node in the same graph —
 * a plan can never point at a task that doesn't exist.
 */
export class TaskGraph {
  private readonly nodes = new Map<string, TaskNode>();
  private readonly dependents = new Map<string, Set<string>>();

  constructor(tasks: readonly TaskNode[]) {
    for (const task of tasks) {
      if (this.nodes.has(task.id)) {
        throw new GraphValidationError(`duplicate task id "${task.id}"`);
      }
      this.nodes.set(task.id, task);
    }
    for (const task of tasks) {
      for (const dep of task.dependsOn) {
        if (!this.nodes.has(dep)) {
          throw new GraphValidationError(`task "${task.id}" depends on unknown task "${dep}"`);
        }
        const set = this.dependents.get(dep) ?? new Set<string>();
        set.add(task.id);
        this.dependents.set(dep, set);
      }
    }
  }

  get size(): number {
    return this.nodes.size;
  }

  getNode(id: string): TaskNode | undefined {
    return this.nodes.get(id);
  }

  listNodes(): readonly TaskNode[] {
    return [...this.nodes.values()];
  }

  dependentsOf(id: string): readonly string[] {
    return [...(this.dependents.get(id) ?? [])];
  }

  roots(): readonly string[] {
    return this.listNodes()
      .filter((task) => task.dependsOn.length === 0)
      .map((task) => task.id);
  }
}

/**
 * Depth-first cycle detection. Returns every distinct cycle found, each as
 * an ordered list of task ids starting and ending at the repeated node.
 */
export function detectCycles(graph: TaskGraph): readonly (readonly string[])[] {
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      cycles.push([...stack.slice(start), id]);
      return;
    }
    visiting.add(id);
    stack.push(id);
    const node = graph.getNode(id);
    for (const dep of node?.dependsOn ?? []) {
      visit(dep);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const node of graph.listNodes()) {
    visit(node.id);
  }
  return cycles;
}

/**
 * Groups task ids into execution levels: level 0 has no dependencies,
 * level N contains every task whose dependencies are all satisfied by
 * levels < N. Tasks within a level have no dependency relationship to one
 * another and are therefore safe to run in parallel; levels themselves
 * must run sequentially relative to each other.
 */
export function computeExecutionLevels(graph: TaskGraph): readonly (readonly string[])[] {
  const cycles = detectCycles(graph);
  if (cycles.length > 0) {
    throw new GraphValidationError(`task graph contains a cycle: ${cycles[0]?.join(" -> ")}`);
  }

  const levelOf = new Map<string, number>();
  const resolve = (id: string): number => {
    const cached = levelOf.get(id);
    if (cached !== undefined) return cached;
    const node = graph.getNode(id);
    if (!node || node.dependsOn.length === 0) {
      levelOf.set(id, 0);
      return 0;
    }
    const level = 1 + Math.max(...node.dependsOn.map((dep) => resolve(dep)));
    levelOf.set(id, level);
    return level;
  };

  for (const node of graph.listNodes()) {
    resolve(node.id);
  }

  const levels: string[][] = [];
  for (const [id, level] of levelOf) {
    const bucket = levels[level] ?? [];
    bucket.push(id);
    levels[level] = bucket;
  }
  return levels.map((bucket) => [...bucket].sort());
}

export interface DependencyAnalysis {
  readonly graph: TaskGraph;
  readonly executionLevels: readonly (readonly string[])[];
}

/**
 * Builds and validates the DAG for a set of tasks in one step — the entry
 * point the Planner Engine calls after Task Generation.
 */
export class DependencyAnalyzer {
  analyze(tasks: readonly TaskNode[]): DependencyAnalysis {
    const graph = new TaskGraph(tasks);
    const executionLevels = computeExecutionLevels(graph);
    return { graph, executionLevels };
  }
}

export function createDependencyAnalyzer(): DependencyAnalyzer {
  return new DependencyAnalyzer();
}
