import type { ToolResult } from "./types.js";

export interface ToolMetricsSnapshot {
  readonly toolId: string;
  readonly invocations: number;
  readonly successes: number;
  readonly failures: number;
  readonly totalDurationMs: number;
  readonly averageDurationMs: number;
  readonly successRate: number;
}

interface MutableCounters {
  invocations: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
}

/**
 * Aggregated, per-tool invocation statistics — distinct from
 * `ToolDiagnostics`' bounded raw-history ring buffer: this is O(1)-space
 * running counters, suitable for a long-lived process where per-call
 * history would grow unbounded.
 */
export class ToolMetrics {
  private readonly counters = new Map<string, MutableCounters>();

  record(result: ToolResult): void {
    const counters = this.counters.get(result.toolId) ?? {
      invocations: 0,
      successes: 0,
      failures: 0,
      totalDurationMs: 0,
    };
    counters.invocations += 1;
    counters.totalDurationMs += result.durationMs;
    if (result.status === "ok") counters.successes += 1;
    else counters.failures += 1;
    this.counters.set(result.toolId, counters);
  }

  snapshot(toolId: string): ToolMetricsSnapshot | undefined {
    const counters = this.counters.get(toolId);
    if (!counters) return undefined;
    return {
      toolId,
      ...counters,
      averageDurationMs:
        counters.invocations === 0 ? 0 : counters.totalDurationMs / counters.invocations,
      successRate: counters.invocations === 0 ? 0 : counters.successes / counters.invocations,
    };
  }

  allSnapshots(): readonly ToolMetricsSnapshot[] {
    return [...this.counters.keys()]
      .map((toolId) => this.snapshot(toolId))
      .filter((snapshot): snapshot is ToolMetricsSnapshot => snapshot !== undefined);
  }

  mostUsedTools(limit = 5): readonly ToolMetricsSnapshot[] {
    return [...this.allSnapshots()].sort((a, b) => b.invocations - a.invocations).slice(0, limit);
  }
}

export function createToolMetrics(): ToolMetrics {
  return new ToolMetrics();
}
