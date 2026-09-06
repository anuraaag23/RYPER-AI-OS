import {
  createOpenAICompatibleProvider,
  type HttpFetch,
  type ProviderChatRequest,
  type StreamEvent,
} from "@ryper/ai-engine";
import type { LocalRuntimeProvider, ModelType } from "../types.js";

export interface LlamaCppConfig {
  readonly id: string;
  /** e.g. http://localhost:8080/v1 — llama.cpp's `server` binary exposes an OpenAI-compatible API at this shape. */
  readonly baseUrl: string;
  /** Forwarded to `createOpenAICompatibleProvider` — see its own doc comment. Defaults to `false`. */
  readonly disableThinkingForToolCalls?: boolean;
}

/**
 * llama.cpp's built-in server speaks the OpenAI Chat Completions wire
 * format, so this adapter is a thin wrapper over
 * `@ryper/ai-engine`'s `createOpenAICompatibleProvider` — no new SSE
 * parsing logic to duplicate or drift from the cloud adapter's.
 */
export function createLlamaCppProvider(
  config: LlamaCppConfig,
  httpFetch: HttpFetch,
): LocalRuntimeProvider {
  const supportedModelTypes: readonly ModelType[] = ["chat"];

  return {
    id: config.id,
    kind: "llama-cpp",
    supportedModelTypes,

    async isAvailable(): Promise<boolean> {
      try {
        const response = await httpFetch(`${config.baseUrl}/models`, {
          method: "GET",
          headers: {},
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    streamChat(modelId: string, request: ProviderChatRequest): AsyncIterable<StreamEvent> {
      const delegate = createOpenAICompatibleProvider(
        {
          id: config.id,
          baseUrl: config.baseUrl,
          apiKey: "not-required-for-local-server",
          model: modelId,
          ...(config.disableThinkingForToolCalls !== undefined
            ? { disableThinkingForToolCalls: config.disableThinkingForToolCalls }
            : {}),
        },
        httpFetch,
      );
      return delegate.streamChat(request);
    },
  };
}
