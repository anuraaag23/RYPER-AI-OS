import type { ProviderChatRequest, StreamEvent } from "@ryper/ai-engine";
import type {
  EmbeddingRequest,
  EmbeddingResult,
  LocalRuntimeProvider,
  ModelType,
} from "../types.js";

/**
 * MLX has no cross-platform JS binding — real usage is via a native Swift
 * or Python bridge. This is the minimal contract this adapter needs from
 * whatever bridge a macOS shell provides.
 */
export interface MlxBinding {
  generateStream(modelId: string, prompt: string): AsyncIterable<string>;
  embed(modelId: string, text: string): Promise<readonly number[]>;
}

export interface MlxRuntimeConfig {
  readonly id: string;
  readonly binding: MlxBinding;
  /** Real detection (Apple Silicon + MLX runtime present) supplied by the macOS shell — never guessed here. */
  readonly checkAvailable: () => Promise<boolean>;
}

function flattenPrompt(request: ProviderChatRequest): string {
  return request.messages.map((m) => `${m.role}: ${m.content}`).join("\n");
}

/**
 * Wraps an injected `MlxBinding` (the macOS shell's native bridge into
 * Apple's MLX framework) into the same `LocalRuntimeProvider` contract
 * every other runtime implements, so the runtime manager treats an
 * Apple-Silicon-only engine identically to llama.cpp/Ollama/ONNX.
 */
export function createMlxRuntimeProvider(config: MlxRuntimeConfig): LocalRuntimeProvider {
  return {
    id: config.id,
    kind: "mlx",
    supportedModelTypes: ["chat", "embedding"] as const satisfies readonly ModelType[],
    isAvailable: config.checkAvailable,

    async *streamChat(modelId: string, request: ProviderChatRequest): AsyncIterable<StreamEvent> {
      const prompt = flattenPrompt(request);
      for await (const token of config.binding.generateStream(modelId, prompt)) {
        yield { type: "text_delta", delta: token };
      }
      yield { type: "done", finishReason: "stop" };
    },

    async embed(modelId: string, request: EmbeddingRequest): Promise<EmbeddingResult> {
      const vector = await config.binding.embed(modelId, request.text);
      return { vector };
    },
  };
}
