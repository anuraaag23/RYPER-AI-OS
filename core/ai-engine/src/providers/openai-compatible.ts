import type { AIProvider, ProviderChatRequest, StreamEvent, ToolCallRequest } from "../types.js";
import type { HttpFetch } from "./transport.js";
import { assertOk } from "./transport.js";
import { parseSSEStream } from "./sse.js";

export interface OpenAICompatibleConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /**
   * Sends `chat_template_kwargs: { enable_thinking: false }` whenever a
   * request includes `tools` — the mechanism llama.cpp's server (and
   * vLLM/SGLang) use to disable Qwen3's "thinking" chain-of-thought for
   * a request, which the model's own documentation recommends for more
   * deterministic tool-call generation. Left `undefined`/`false` by
   * default since this field is meaningless (and, on a strict
   * validator, potentially rejected) by real OpenAI/other cloud
   * endpoints that this same provider class also serves — only
   * `createLlamaCppProvider` opts in. See docs/adr/0022.
   */
  readonly disableThinkingForToolCalls?: boolean;
}

interface OpenAIStreamChunk {
  readonly choices?: ReadonlyArray<{
    readonly delta?: {
      readonly content?: string;
      /**
       * Some OpenAI-compatible servers (vLLM, SGLang, recent llama.cpp
       * builds) surface a "thinking"/chain-of-thought model's hidden
       * reasoning under this field, separate from `content`. Not
       * forwarded as visible text — only used as a real-activity signal
       * so a long thinking phase doesn't starve `withTimeout()`.
       */
      readonly reasoning_content?: string;
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
            ...(m.toolCalls && m.toolCalls.length > 0
              ? {
                  tool_calls: m.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: "function",
                    function: {
                      name: tc.name,
                      arguments: JSON.stringify(tc.arguments ?? {}),
                    },
                  })),
                }
              : {}),
          })),
          ...(request.tools && request.tools.length > 0
            ? {
                tools: request.tools.map((t) => ({
                  type: "function",
                  function: { name: t.name, description: t.description, parameters: t.parameters },
                })),
                ...(config.disableThinkingForToolCalls
                  ? { chat_template_kwargs: { enable_thinking: false } }
                  : {}),
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

        // Real activity signal for hidden "thinking"/reasoning content
        // (see OpenAIStreamChunk's doc comment) — not shown to the
        // caller as text, but genuine wire activity all the same, so it
        // must reset withTimeout()'s inter-event timer rather than
        // silently vanishing.
        if (choice.delta?.reasoning_content) {
          yield { type: "tool_call_progress" };
        }

        if (choice.delta?.tool_calls && choice.delta.tool_calls.length > 0) {
          for (const toolCall of choice.delta.tool_calls) {
            const existing = pendingToolCalls.get(toolCall.index) ?? { id: "", name: "", args: "" };
            if (toolCall.id) existing.id = toolCall.id;
            if (toolCall.function?.name) existing.name = toolCall.function.name;
            if (toolCall.function?.arguments) existing.args += toolCall.function.arguments;
            pendingToolCalls.set(toolCall.index, existing);
          }
          // Root cause of the real-hardware "no stream event within
          // 30000ms" failure (docs/adr/0022): a tool call's arguments
          // arrive as many small fragments across many SSE chunks, but
          // a fragment isn't valid JSON on its own, so nothing else in
          // this loop yields anything for it — previously this entire
          // accumulation phase (which, for a local 8B model, can
          // genuinely take tens of seconds) was invisible to
          // withTimeout()'s per-event timer. This heartbeat is real
          // evidence real wire activity happened, without exposing a
          // half-built tool call to the caller.
          yield { type: "tool_call_progress" };
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
