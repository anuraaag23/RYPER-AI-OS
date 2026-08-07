import type { AIProvider, ProviderChatRequest, StreamEvent, ToolCallRequest } from "../types.js";
import type { HttpFetch } from "./transport.js";
import { assertOk } from "./transport.js";
import { parseSSEStream } from "./sse.js";

export interface OpenAICompatibleConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

interface OpenAIStreamChunk {
  readonly choices?: ReadonlyArray<{
    readonly delta?: {
      readonly content?: string;
      readonly tool_calls?: ReadonlyArray<{
        readonly index: number;
        readonly id?: string;
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }>;
    };
    readonly finish_reason?: string | null;
  }>;
}

function mapFinishReason(reason: string | null | undefined): "stop" | "tool_calls" | "length" {
  if (reason === "tool_calls") return "tool_calls";
  if (reason === "length") return "length";
  return "stop";
}

/**
 * Targets any Chat Completions API that follows the OpenAI wire format
 * (OpenAI itself, and the many self-hosted/gateway servers that mirror it).
 * Tool-call argument fragments arrive split across chunks and are
 * accumulated per tool-call index until a finish_reason closes the turn.
 */
export function createOpenAICompatibleProvider(
  config: OpenAICompatibleConfig,
  httpFetch: HttpFetch,
): AIProvider {
  return {
    id: config.id,
    kind: "openai-compatible",
    async *streamChat(request: ProviderChatRequest): AsyncIterable<StreamEvent> {
      const response = await httpFetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          stream: true,
          messages: request.messages.map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
            ...(m.name ? { name: m.name } : {}),
          })),
          ...(request.tools
            ? {
                tools: request.tools.map((t) => ({
                  type: "function",
                  function: { name: t.name, description: t.description, parameters: t.parameters },
                })),
              }
            : {}),
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        }),
        signal: request.signal,
      });
      await assertOk(response);

      const body = response.body();
      if (!body) {
        yield {
          type: "error",
          message: "openai-compatible provider: response had no streamable body",
        };
        return;
      }

      const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();

      for await (const message of parseSSEStream(body)) {
        if (message.data === "[DONE]") continue;
        const chunk = JSON.parse(message.data) as OpenAIStreamChunk;
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.delta?.content) {
          yield { type: "text_delta", delta: choice.delta.content };
        }

        for (const toolCall of choice.delta?.tool_calls ?? []) {
          const existing = pendingToolCalls.get(toolCall.index) ?? { id: "", name: "", args: "" };
          if (toolCall.id) existing.id = toolCall.id;
          if (toolCall.function?.name) existing.name = toolCall.function.name;
          if (toolCall.function?.arguments) existing.args += toolCall.function.arguments;
          pendingToolCalls.set(toolCall.index, existing);
        }

        if (choice.finish_reason) {
          for (const pending of pendingToolCalls.values()) {
            const toolCall: ToolCallRequest = {
              id: pending.id,
              name: pending.name,
              arguments:
                pending.args.length > 0
                  ? (JSON.parse(pending.args) as Record<string, unknown>)
                  : {},
            };
            yield { type: "tool_call", toolCall };
          }
          yield { type: "done", finishReason: mapFinishReason(choice.finish_reason) };
        }
      }
    },
  };
}
