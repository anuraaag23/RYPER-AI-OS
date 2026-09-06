import type { ToolResult, ToolResultStatus } from "./types.js";

/** Framework-level error codes distinct from a tool's own declared `errorCodes`. */
export const FRAMEWORK_ERROR_CODES = {
  UNKNOWN_TOOL: "framework.unknown_tool",
  VALIDATION_FAILED: "framework.validation_failed",
  PERMISSION_DENIED: "framework.permission_denied",
  TIMEOUT: "framework.timeout",
  CANCELLED: "framework.cancelled",
  EXECUTION_THREW: "framework.execution_threw",
} as const;

export interface BuildResultOptions {
  readonly invocationId: string;
  readonly toolId: string;
  readonly status: ToolResultStatus;
  readonly startedAt: string;
  readonly attempts: number;
  readonly value?: unknown;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export function buildToolResult(options: BuildResultOptions): ToolResult {
  const finishedAt = new Date().toISOString();
  const durationMs = new Date(finishedAt).getTime() - new Date(options.startedAt).getTime();
  return {
    invocationId: options.invocationId,
    toolId: options.toolId,
    status: options.status,
    finishedAt,
    durationMs,
    attempts: options.attempts,
    ...(options.value !== undefined ? { value: options.value } : {}),
    ...(options.errorCode !== undefined ? { errorCode: options.errorCode } : {}),
    ...(options.errorMessage !== undefined ? { errorMessage: options.errorMessage } : {}),
    startedAt: options.startedAt,
  };
}

export function isSuccessful(result: ToolResult): boolean {
  return result.status === "ok";
}
