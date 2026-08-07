import type {
  AIProvider,
  ProviderChatRequest,
  StreamEvent,
  ToolCallRequest,
  ChatMessage,
} from "../types.js";
import type { HttpFetch } from "./transport.js";
import { assertOk } from "./transport.js";
import { parseSSEStream } from "./sse.js";

export interface AnthropicCompatibleConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly anthropicVersion?: string;
}

type AnthropicEvent =
  | {
      readonly type: "content_block_start";
      readonly index: number;
      readonly content_block: {
        readonly type: string;
        readonly id?: string;
        readonly name?: string;
      };
    }
  | {
      readonly type: "content_block_delta";
      readonly index: number;
      readonly delta: {
        readonly type: string;
        readonly text?: string;
        readonly partial_json?: string;
      };
    }
  | { readonly type: "content_block_stop"; readonly index: number }
  | { readonly type: "message_delta"; readonly delta: { readonly stop_reason?: string | null } }
  | { readonly type: "message_stop" }
  | { readonly type: "error"; readonly error: { readonly message: string } };

function splitSystemMessage(messages: readonly ChatMessage[]): {
  system: string | undefined;
  rest: ChatMessage[];
} {
  const systemMessages = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  return {
    system: systemMessages.length > 0 ? systemMessages.map((m) => m.content).join("\n") : undefined,
    rest,
  };
}

function mapStopReason(reason: string | null | undefined): "stop" | "tool_calls" | "length" {
  if (reason === "tool_use") return "tool_calls";
  if (reason === "max_tokens") return "length";
  return "stop";
}

/**
 * Targets the Anthropic Messages API streaming format (and any gateway that
 * mirrors it). Tool use blocks stream their JSON input incrementally as
 * `partial_json` deltas, accumulated per content-block index until that
 * block closes.
 */
export function createAnthropicCompatibleProvider(
  config: AnthropicCompatibleConfig,
  httpFetch: HttpFetch,
): AIProvider {
  return {
    id: config.id,
    kind: "anthropic-compatible",
    async *streamChat(request: ProviderChatRequest): AsyncIterable<StreamEvent> {
      const { system, rest } = splitSystemMessage(request.messages);

      const response = await httpFetch(`${config.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": config.anthropicVersion ?? "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model,
          stream: true,
          max_tokens: request.maxTokens ?? 4096,
          ...(system ? { system } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          messages: rest.map((m) =>
            m.role === "tool"
              ? {
                  role: "user",
                  content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
                }
              : { role: m.role, content: m.content },
          ),
          ...(request.tools
            ? {
                tools: request.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  input_schema: t.parameters,
                })),
              }
            : {}),
        }),
        signal: request.signal,
      });
      await assertOk(response);

      const body = response.body();
      if (!body) {
        yield {
          type: "error",
          message: "anthropic-compatible provider: response had no streamable body",
        };
        return;
      }

      const pendingToolCalls = new Map<number, { id: string; name: string; json: string }>();

      for await (const message of parseSSEStream(body)) {
        const event = JSON.parse(message.data) as AnthropicEvent;

        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          pendingToolCalls.set(event.index, {
            id: event.content_block.id ?? "",
            name: event.content_block.name ?? "",
            json: "",
          });
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta" && event.delta.text) {
            yield { type: "text_delta", delta: event.delta.text };
          } else if (event.delta.type === "input_json_delta" && event.delta.partial_json) {
            const pending = pendingToolCalls.get(event.index);
            if (pending) pending.json += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          const pending = pendingToolCalls.get(event.index);
          if (pending) {
            const toolCall: ToolCallRequest = {
              id: pending.id,
              name: pending.name,
              arguments:
                pending.json.length > 0
                  ? (JSON.parse(pending.json) as Record<string, unknown>)
                  : {},
            };
            yield { type: "tool_call", toolCall };
            pendingToolCalls.delete(event.index);
          }
        } else if (event.type === "message_delta") {
          yield { type: "done", finishReason: mapStopReason(event.delta.stop_reason) };
        } else if (event.type === "error") {
          yield { type: "error", message: event.error.message };
        }
      }
    },
  };
}
