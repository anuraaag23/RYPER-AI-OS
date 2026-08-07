import type { ToolResult } from "./types.js";

export interface ToolDiagnosticsSummary {
  readonly totalInvocations: number;
  readonly recentFailureRate: number;
}

/**
 * Bounded recent-invocation history, mirroring `@ryper/planner`'s
 * `PlannerDiagnostics` shape at the tool-execution layer: a fixed-size
 * ring buffer so a long-running process never accumulates unbounded
 * memory, plus a running total count independent of the buffer size.
 */
export class ToolDiagnostics {
  private readonly history: ToolResult[] = [];
  private total = 0;

  constructor(private readonly historySize = 100) {}

  record(result: ToolResult): void {
    this.total += 1;
    this.history.push(result);
    if (this.history.length > this.historySize) this.history.shift();
  }

  recent(): readonly ToolResult[] {
    return [...this.history];
  }

  totalInvocations(): number {
    return this.total;
  }

  summary(): ToolDiagnosticsSummary {
    const failures = this.history.filter((result) => result.status !== "ok").length;
    return {
      totalInvocations: this.total,
      recentFailureRate: this.history.length === 0 ? 0 : failures / this.history.length,
    };
  }
}

export function createToolDiagnostics(historySize?: number): ToolDiagnostics {
  return new ToolDiagnostics(historySize);
}
