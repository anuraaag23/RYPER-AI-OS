import { describe, expect, it } from "vitest";
import {
  DependencyAnalyzer,
  GraphValidationError,
  TaskGraph,
  computeExecutionLevels,
  detectCycles,
} from "../src/dependency-analyzer.js";
import type { TaskNode } from "../src/types.js";

function task(id: string, dependsOn: readonly string[] = []): TaskNode {
  return {
    id,
    taskType: "ai",
    operation: "respond",
    description: id,
    parameters: {},
    dependsOn,
    priority: "normal",
  };
}

describe("TaskGraph", () => {
  it("builds a graph and reports roots", () => {
    const graph = new TaskGraph([task("a"), task("b", ["a"])]);
    expect(graph.size).toBe(2);
    expect(graph.roots()).toEqual(["a"]);
    expect(graph.dependentsOf("a")).toEqual(["b"]);
  });

  it("rejects a duplicate task id", () => {
    expect(() => new TaskGraph([task("a"), task("a")])).toThrow(GraphValidationError);
  });

  it("rejects a dependency on an unknown task", () => {
    expect(() => new TaskGraph([task("a", ["missing"])])).toThrow(GraphValidationError);
  });
});

describe("detectCycles", () => {
  it("finds no cycles in a valid DAG", () => {
    const graph = new TaskGraph([task("a"), task("b", ["a"]), task("c", ["b"])]);
    expect(detectCycles(graph)).toHaveLength(0);
  });

  it("detects a direct cycle", () => {
    const graph = new TaskGraph([task("a", ["b"]), task("b", ["a"])]);
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
  });
});

describe("computeExecutionLevels", () => {
  it("places independent tasks in the same level", () => {
    const graph = new TaskGraph([task("a"), task("b"), task("c", ["a", "b"])]);
    const levels = computeExecutionLevels(graph);
    expect(levels[0]).toEqual(["a", "b"]);
    expect(levels[1]).toEqual(["c"]);
  });

  it("throws a GraphValidationError when the graph has a cycle", () => {
    const graph = new TaskGraph([task("a", ["b"]), task("b", ["a"])]);
    expect(() => computeExecutionLevels(graph)).toThrow(GraphValidationError);
  });
});

describe("DependencyAnalyzer", () => {
  it("analyzes a task list into a graph and execution levels in one call", () => {
    const analyzer = new DependencyAnalyzer();
    const { graph, executionLevels } = analyzer.analyze([task("a"), task("b", ["a"])]);
    expect(graph.size).toBe(2);
    expect(executionLevels).toEqual([["a"], ["b"]]);
  });
});
