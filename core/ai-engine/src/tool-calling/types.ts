import type { Capability } from "@ryper/security";
import type { ToolSpec } from "../types.js";

export interface ToolExecutionContext {
  readonly sessionId: string;
  readonly signal?: AbortSignal | undefined;
}

export interface ToolResult {
  readonly toolCallId: string;
  readonly ok: boolean;
  /** Stringified for direct use as a ChatMessage's content — tools decide their own serialization. */
  readonly content: string;
}

export interface ToolDefinition {
  readonly spec: ToolSpec;
  /** If set, invocation is refused unless this capability was already granted via the CapabilityBroker. */
  readonly requiredCapability?: Capability;
  execute(
    args: Readonly<Record<string, unknown>>,
    context: ToolExecutionContext,
  ): Promise<unknown> | unknown;
}

/**
 * Actual tool implementations (filesystem, browser, documents, calendar,
 * ...) land in later phases per the brief. This module defines the
 * contract they all implement and the request/result shapes the
 * orchestrator moves between the model and the tool.
 */
export function buildToolResult(toolCallId: string, ok: boolean, value: unknown): ToolResult {
  const content = typeof value === "string" ? value : JSON.stringify(value);
  return { toolCallId, ok, content };
}
