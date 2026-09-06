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
  // PART 16's "tool result with empty content" case: `value` can
  // genuinely be `undefined` (a tool whose `execute()` has no explicit
  // return) or `null`. `JSON.stringify(undefined)` returns the *actual
  // JS value* `undefined`, not the string `"undefined"` — silently
  // producing a `content` that violates `ToolResult`'s own `string`
  // type at runtime, which could then reach `AIOrchestrator`'s message
  // history as a literal `undefined` value. Handled explicitly here so
  // `content` is always a real string, never `undefined`.
  if (typeof value === "string") return { toolCallId, ok, content: value };
  if (value === undefined || value === null) return { toolCallId, ok, content: "" };
  return { toolCallId, ok, content: JSON.stringify(value) };
}
