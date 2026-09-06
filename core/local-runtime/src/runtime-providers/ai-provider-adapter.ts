import type { AIProvider, ProviderChatRequest, ProviderKind, StreamEvent } from "@ryper/ai-engine";
import type { LocalRuntimeManager, InferenceContext } from "../runtime-manager.js";

/**
 * `LocalRuntimeManager.streamChat()` (Phase 4) already implements
 * exactly the local-first-with-explicit-cloud-fallback behavior
 * `@ryper/ai-engine`'s `AIOrchestrator`/`ProviderRegistry` needs: try
 * every registered local `chat`-capable `LocalRuntimeProvider` (e.g.
 * `createLlamaCppProvider`), and only fall back to a cloud `AIProvider`
 * if one was explicitly configured as `cloudChatFallback` — this
 * adapter is the thin seam connecting that real, existing machinery to
 * `ProviderRegistry` without duplicating any of it.
 */
export function createLocalRuntimeAIProvider(
  id: string,
  manager: LocalRuntimeManager,
  context: InferenceContext,
): AIProvider {
  const kind: ProviderKind = "local";
  return {
    id,
    kind,
    streamChat(request: ProviderChatRequest): AsyncIterable<StreamEvent> {
      return manager.streamChat(request, {
        ...context,
        ...(request.signal ? { signal: request.signal } : {}),
      });
    },
  };
}
