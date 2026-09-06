import {
  createOllamaCompatibleProvider,
  assertOk,
  type HttpFetch,
  type ProviderChatRequest,
  type StreamEvent,
} from "@ryper/ai-engine";
import type {
  EmbeddingRequest,
  EmbeddingResult,
  LocalRuntimeProvider,
  ModelType,
} from "../types.js";

export interface OllamaRuntimeConfig {
  readonly id: string;
  readonly baseUrl: string; // e.g. http://localhost:11434
}

interface OllamaEmbeddingsResponse {
  readonly embedding?: readonly number[];
}

/**
 * Wraps `@ryper/ai-engine`'s `createOllamaCompatibleProvider` for chat (so
 * the NDJSON parsing lives in exactly one place) and adds a real call to
 * Ollama's `/api/embeddings` endpoint, which is a single JSON
 * request/response rather than a stream.
 */
export function createOllamaRuntimeProvider(
  config: OllamaRuntimeConfig,
  httpFetch: HttpFetch,
): LocalRuntimeProvider {
  const supportedModelTypes: readonly ModelType[] = ["chat", "embedding"];

  return {
    id: config.id,
    kind: "ollama",
    supportedModelTypes,

    async isAvailable(): Promise<boolean> {
      try {
        const response = await httpFetch(`${config.baseUrl}/api/tags`, {
          method: "GET",
          headers: {},
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    streamChat(modelId: string, request: ProviderChatRequest): AsyncIterable<StreamEvent> {
      const delegate = createOllamaCompatibleProvider(
        { id: config.id, baseUrl: config.baseUrl, model: modelId },
        httpFetch,
      );
      return delegate.streamChat(request);
    },

    async embed(modelId: string, request: EmbeddingRequest): Promise<EmbeddingResult> {
      const response = await httpFetch(`${config.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: modelId, prompt: request.text }),
      });
      await assertOk(response);
      const body = (await response.text()) || "{}";
      const parsed = JSON.parse(body) as OllamaEmbeddingsResponse;
      return { vector: parsed.embedding ?? [] };
    },
  };
}
