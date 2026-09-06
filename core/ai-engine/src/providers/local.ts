import type { AIProvider, ProviderChatRequest, StreamEvent } from "../types.js";
import type { HttpFetch } from "./transport.js";
import { assertOk } from "./transport.js";
import { parseNDJSONStream } from "./ndjson.js";

export interface LocalModelConfig {
  readonly id: string;
  readonly baseUrl: string; // e.g. http://localhost:11434 for a local Ollama-compatible server
  readonly model: string;
}

interface OllamaStreamChunk {
  readonly message?: { readonly content?: string };
  readonly done?: boolean;
  readonly done_reason?: string;
}

function mapDoneReason(reason: string | undefined): "stop" | "length" {
  return reason === "length" ? "length" : "stop";
}

/**
 * Local inference backend adapter, targeting the Ollama `/api/chat`
 * streaming wire format (one JSON object per line) — the same shape most
 * llama.cpp-based local servers converge on. This is the pluggable seam the
 * architecture calls for: swapping to a different local runtime means
 * writing one more file like this one, not touching the orchestrator.
 *
 * Tool calling is intentionally not wired up here: local model tool-calling
 * support varies widely by runtime/model, so this adapter only emits
 * `text_delta`/`done` for now — it still fully satisfies the `AIProvider`
 * interface.
 */
export function createOllamaCompatibleProvider(
  config: LocalModelConfig,
  httpFetch: HttpFetch,
): AIProvider {
  return {
    id: config.id,
    kind: "local",
    async *streamChat(request: ProviderChatRequest): AsyncIterable<StreamEvent> {
      const response = await httpFetch(`${config.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          stream: true,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          options: {
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          },
        }),
        signal: request.signal,
      });
      await assertOk(response);

      const body = response.body();
      if (!body) {
        yield { type: "error", message: "local provider: response had no streamable body" };
        return;
      }

      for await (const raw of parseNDJSONStream(body)) {
        const chunk = raw as OllamaStreamChunk;
        if (chunk.message?.content) {
          yield { type: "text_delta", delta: chunk.message.content };
        }
        if (chunk.done) {
          yield { type: "done", finishReason: mapDoneReason(chunk.done_reason) };
        }
      }
    },
  };
}
