import { createLogger } from "@ryper/logging";
import type { ToolInvocationRequest, ToolResult } from "./types.js";

const log = createLogger("tool-framework:invocation");

export interface ToolLogEntry {
  readonly invocationId: string;
  readonly toolId: string;
  readonly actorId: string;
  readonly status: ToolResult["status"];
  readonly durationMs: number;
  readonly attempts: number;
  readonly recordedAt: string;
}

/**
 * Structured, correlated logging for every tool invocation — distinct
 * from `ToolDiagnostics`' aggregate history/metrics: this is the
 * per-invocation audit trail (who called what, with what outcome),
 * suitable for security review or debugging one specific request by its
 * `invocationId`.
 */
export class ToolInvocationLogger {
  private readonly entries: ToolLogEntry[] = [];

  constructor(private readonly historySize = 500) {}

  record(request: ToolInvocationRequest, result: ToolResult): ToolLogEntry {
    const entry: ToolLogEntry = {
      invocationId: result.invocationId,
      toolId: result.toolId,
      actorId: request.actorId,
      status: result.status,
      durationMs: result.durationMs,
      attempts: result.attempts,
      recordedAt: new Date().toISOString(),
    };
    this.entries.push(entry);
    if (this.entries.length > this.historySize) this.entries.shift();

    const level = result.status === "ok" ? "info" : "warn";
    log[level]("tool invocation", { ...entry });
    return entry;
  }

  findByInvocationId(invocationId: string): ToolLogEntry | undefined {
    return this.entries.find((entry) => entry.invocationId === invocationId);
  }

  findByToolId(toolId: string): readonly ToolLogEntry[] {
    return this.entries.filter((entry) => entry.toolId === toolId);
  }

  all(): readonly ToolLogEntry[] {
    return [...this.entries];
  }
}

export function createToolInvocationLogger(historySize?: number): ToolInvocationLogger {
  return new ToolInvocationLogger(historySize);
}
