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

export interface GoogleCompatibleConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

interface GeminiPart {
  readonly text?: string;
  readonly functionCall?: { readonly name: string; readonly args?: Record<string, unknown> };
}

interface GeminiStreamChunk {
  readonly candidates?: ReadonlyArray<{
    readonly content?: { readonly parts?: readonly GeminiPart[] };
    readonly finishReason?: string;
  }>;
}

function mapFinishReason(
  reason: string | undefined,
  hadFunctionCall: boolean,
): "stop" | "tool_calls" | "length" {
  if (hadFunctionCall) return "tool_calls";
  if (reason === "MAX_TOKENS") return "length";
  return "stop";
}

function toGeminiRole(role: ChatMessage["role"]): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

let toolCallCounter = 0;

/**
 * Targets the Gemini `generateContent` streaming REST format
 * (`?alt=sse` framing). Gemini has no separate "system" role, so system
 * messages are folded into `systemInstruction`; it also has no tool-call
 * id in its wire format, so this adapter mints one locally (`gemini-call-N`)
 * purely so the orchestrator's tool-result correlation works uniformly
 * across providers.
 */
export function createGoogleCompatibleProvider(
  config: GoogleCompatibleConfig,
  httpFetch: HttpFetch,
): AIProvider {
  return {
    id: config.id,
    kind: "google-compatible",
    async *streamChat(request: ProviderChatRequest): AsyncIterable<StreamEvent> {
      const systemMessages = request.messages.filter((m) => m.role === "system");
      const conversational = request.messages.filter((m) => m.role !== "system");

      const url = `${config.baseUrl}/models/${config.model}:streamGenerateContent?alt=sse&key=${config.apiKey}`;
      const response = await httpFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(systemMessages.length > 0
            ? {
                systemInstruction: {
                  parts: [{ text: systemMessages.map((m) => m.content).join("\n") }],
                },
              }
            : {}),
          contents: conversational.map((m) => ({
            role: toGeminiRole(m.role),
            parts: [{ text: m.content }],
          })),
          ...(request.tools
            ? {
                tools: [
                  {
                    functionDeclarations: request.tools.map((t) => ({
                      name: t.name,
                      description: t.description,
                      parameters: t.parameters,
                    })),
                  },
                ],
              }
            : {}),
          generationConfig: {
            ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          },
        }),
        signal: request.signal,
      });
      await assertOk(response);

      const body = response.body();
      if (!body) {
        yield {
          type: "error",
          message: "google-compatible provider: response had no streamable body",
        };
        return;
      }

      let hadFunctionCall = false;
      let lastFinishReason: string | undefined;

      for await (const message of parseSSEStream(body)) {
        const chunk = JSON.parse(message.data) as GeminiStreamChunk;
        const candidate = chunk.candidates?.[0];
        if (!candidate) continue;
        if (candidate.finishReason) lastFinishReason = candidate.finishReason;

        for (const part of candidate.content?.parts ?? []) {
          if (part.text) {
            yield { type: "text_delta", delta: part.text };
          } else if (part.functionCall) {
            hadFunctionCall = true;
            toolCallCounter += 1;
            const toolCall: ToolCallRequest = {
              id: `gemini-call-${toolCallCounter}`,
              name: part.functionCall.name,
              arguments: part.functionCall.args ?? {},
            };
            yield { type: "tool_call", toolCall };
          }
        }
      }

      yield { type: "done", finishReason: mapFinishReason(lastFinishReason, hadFunctionCall) };
    },
  };
}
