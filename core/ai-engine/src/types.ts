/**
 * Central type vocabulary for the Core AI Engine. Every provider adapter
 * normalizes its wire format into these shapes, so the orchestrator, tool
 * framework, and context manager never need to know which concrete AI
 * provider produced an event.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
  /** Present when role === "tool": which tool call this message answers. */
  readonly toolCallId?: string;
  /** Present when role === "tool": the tool's name, for providers that require it. */
  readonly name?: string;
  /** Present when role === "assistant" and model requested tool calls. */
  readonly toolCalls?: readonly ToolCallRequest[];
}

export interface ToolParameterPropertySchema {
  readonly type: "string" | "number" | "boolean" | "integer" | "array" | "object";
  readonly description?: string;
  readonly enum?: readonly (string | number)[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

export interface ToolParameterSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, ToolParameterPropertySchema>>;
  readonly required?: readonly string[];
}

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParameterSchema;
}

export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export type FinishReason = "stop" | "tool_calls" | "length" | "error" | "cancelled";

export type StreamEvent =
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "tool_call"; readonly toolCall: ToolCallRequest }
  /**
   * The real, authoritative outcome of a tool's `execute()` call —
   * `ok`/`content` straight from `ToolRegistry.invoke()`'s
   * `ToolResult`, exposed so a caller (including a real integration
   * test) can tell a genuinely successful tool call apart from one
   * that failed but was narrated by the model as if it might have
   * succeeded. Before this event existed, `AIOrchestrator` absorbed
   * the tool result into the next round's message history and never
   * surfaced it — a real gap: the model receiving and describing a
   * failure gracefully (which it is designed to do) is not evidence
   * the underlying action actually worked. See docs/adr/0023.
   */
  | {
      readonly type: "tool_result";
      readonly toolCallId: string;
      readonly name: string;
      readonly ok: boolean;
      readonly content: string;
    }
  /**
   * A provider received real wire activity (a tool-call argument
   * fragment, or hidden "thinking"/reasoning content) that doesn't map
   * to a user-visible event on its own — a partial tool-call argument
   * isn't valid JSON yet, and reasoning content shouldn't be shown as
   * if it were the assistant's reply. Emitted purely so
   * `withTimeout()`'s inter-event timer sees genuine progress during a
   * long tool-call generation instead of timing out on a connection
   * that is, in fact, still actively streaming (see docs/adr/0022).
   * `AIOrchestrator` consumes these internally and never forwards them
   * to its own callers.
   */
  | { readonly type: "tool_call_progress" }
  | { readonly type: "done"; readonly finishReason: FinishReason }
  | { readonly type: "error"; readonly message: string };

export interface ProviderChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolSpec[];
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly signal?: AbortSignal | undefined;
}

export type ProviderKind =
  "openai-compatible" | "anthropic-compatible" | "google-compatible" | "local";

export interface AIProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  streamChat(request: ProviderChatRequest): AsyncIterable<StreamEvent>;
}
