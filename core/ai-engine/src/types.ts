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
}

export interface ToolParameterSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
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
