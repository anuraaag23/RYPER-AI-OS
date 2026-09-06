import { createLogger } from "@ryper/logging";
import type { EventBus } from "@ryper/event-bus";
import type { AIProvider, ProviderChatRequest, StreamEvent } from "@ryper/ai-engine";

import type {
  ASRRequest,
  ASRResult,
  DeviceCapabilities,
  EmbeddingRequest,
  EmbeddingResult,
  ImageEditRequest,
  ImageEditResult,
  LocalRuntimeProvider,
  ModelType,
  OCRRequest,
  OCRResult,
  TTSRequest,
  TTSResult,
  TranslationRequest,
  TranslationResult,
  VisionRequest,
  VisionResult,
} from "./types.js";
import type { ModelSelector } from "./model-selection-policy.js";
import type { RuntimeHealthMonitor } from "./health-monitor.js";
import type { ModelCache } from "./model-cache.js";
import type { InferenceQueue } from "./inference-queue.js";
import type { OfflineStatusDetector } from "./offline-status.js";

const log = createLogger("local-runtime:manager");

export class MissingModelError extends Error {
  constructor(taskType: ModelType) {
    super(`no installed, device-eligible model is registered for task type "${taskType}"`);
    this.name = "MissingModelError";
  }
}

export class AllProvidersFailedError extends Error {
  constructor(
    taskType: ModelType,
    public readonly attempts: readonly string[],
  ) {
    super(`every eligible provider failed for task type "${taskType}": ${attempts.join("; ")}`);
    this.name = "AllProvidersFailedError";
  }
}

export interface InferenceContext {
  readonly device: DeviceCapabilities;
  readonly privacySensitive?: boolean | undefined;
  readonly preferredModelId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
  readonly priority?: number | undefined;
}

export interface LocalRuntimeManagerOptions {
  readonly registry: ModelSelector;
  readonly providers: readonly LocalRuntimeProvider[];
  readonly healthMonitor: RuntimeHealthMonitor;
  readonly queue: InferenceQueue;
  readonly cache: ModelCache;
  readonly offlineStatus?: OfflineStatusDetector;
  readonly eventBus?: EventBus;
  /** Used only as the last resort for chat when no local provider can serve the request. Never called for other task types. */
  readonly cloudChatFallback?: AIProvider;
}

interface Candidate {
  readonly modelId: string;
  readonly runtimeModelId: string;
  readonly provider: LocalRuntimeProvider;
}

/**
 * The single entry point the Core AI Engine and future modules use for
 * on-device inference. It never exposes llama.cpp/Ollama/ONNX/MLX-specific
 * types in its public surface for the task methods below — callers get
 * back the same normalized result shapes regardless of which runtime and
 * model actually served the request.
 */
export class LocalRuntimeManager {
  constructor(private readonly options: LocalRuntimeManagerOptions) {}

  private async findCandidates(
    taskType: ModelType,
    context: InferenceContext,
  ): Promise<Candidate[]> {
    const ranked = this.options.registry.selectRanked({
      taskType,
      device: context.device,
      privacySensitive: context.privacySensitive,
      preferredModelId: context.preferredModelId,
    });

    const candidates: Candidate[] = [];
    for (const model of ranked) {
      const provider = this.options.providers.find(
        (p) => p.kind === model.runtime && p.supportedModelTypes.includes(taskType),
      );
      if (!provider) continue;
      if (!this.options.healthMonitor.isUsable(provider.id)) continue;
      candidates.push({ modelId: model.id, runtimeModelId: model.runtimeModelId, provider });
    }
    return candidates;
  }

  /**
   * Runs `invoke` against each eligible (model, provider) candidate in
   * order, falling back to the next on any failure and recording
   * success/failure with the health monitor as it goes. Throws
   * `MissingModelError` if there was nothing eligible to try at all, or
   * `AllProvidersFailedError` if every attempt failed.
   */
  private async runWithFallback<T>(
    taskType: ModelType,
    context: InferenceContext,
    invoke: (provider: LocalRuntimeProvider, runtimeModelId: string) => Promise<T>,
  ): Promise<{ result: T; modelId: string; providerId: string }> {
    const candidates = await this.findCandidates(taskType, context);
    if (candidates.length === 0) {
      throw new MissingModelError(taskType);
    }

    const attempts: string[] = [];
    for (const candidate of candidates) {
      const startedAt = Date.now();
      try {
        const result = await this.options.queue.enqueue(
          () => invoke(candidate.provider, candidate.runtimeModelId),
          { signal: context.signal, timeoutMs: context.timeoutMs, priority: context.priority },
        );
        this.options.healthMonitor.recordSuccess(candidate.provider.id, Date.now() - startedAt);
        this.options.cache.recordUse(candidate.modelId);
        log.info("[DIAGNOSTIC] local runtime provider success", {
          taskType,
          providerId: candidate.provider.id,
          modelId: candidate.modelId,
          durationMs: Date.now() - startedAt,
        });
        return { result, modelId: candidate.modelId, providerId: candidate.provider.id };
      } catch (err) {
        this.options.healthMonitor.recordFailure(candidate.provider.id);
        attempts.push(`${candidate.provider.id}: ${String(err)}`);
        log.warn("candidate failed, trying next", {
          provider: candidate.provider.id,
          model: candidate.modelId,
        });
      }
    }

    throw new AllProvidersFailedError(taskType, attempts);
  }

  async embed(request: EmbeddingRequest, context: InferenceContext): Promise<EmbeddingResult> {
    const { result } = await this.runWithFallback("embedding", context, (provider, modelId) => {
      if (!provider.embed)
        throw new Error(`provider "${provider.id}" declared embedding support but has no embed()`);
      return provider.embed(modelId, request);
    });
    return result;
  }

  async ocr(request: OCRRequest, context: InferenceContext): Promise<OCRResult> {
    const { result } = await this.runWithFallback("ocr", context, (provider, modelId) => {
      if (!provider.ocr)
        throw new Error(`provider "${provider.id}" declared OCR support but has no ocr()`);
      return provider.ocr(modelId, request);
    });
    return result;
  }

  async translate(
    request: TranslationRequest,
    context: InferenceContext,
  ): Promise<TranslationResult> {
    const { result } = await this.runWithFallback("translation", context, (provider, modelId) => {
      if (!provider.translate)
        throw new Error(
          `provider "${provider.id}" declared translation support but has no translate()`,
        );
      return provider.translate(modelId, request);
    });
    return result;
  }

  async transcribe(request: ASRRequest, context: InferenceContext): Promise<ASRResult> {
    // Forwarded onto the request itself (additive, optional field) so a
    // provider that can cancel a real in-flight process (e.g. killing a
    // whisper.cpp child process) can honor it directly — queue-level
    // cancellation alone only stops work that hasn't started yet.
    const enrichedRequest: ASRRequest = context.signal
      ? { ...request, signal: context.signal }
      : request;
    const { result } = await this.runWithFallback("asr", context, (provider, modelId) => {
      if (!provider.transcribe)
        throw new Error(`provider "${provider.id}" declared ASR support but has no transcribe()`);
      return provider.transcribe(modelId, enrichedRequest);
    });
    return result;
  }

  async synthesizeSpeech(request: TTSRequest, context: InferenceContext): Promise<TTSResult> {
    const enrichedRequest: TTSRequest = context.signal
      ? { ...request, signal: context.signal }
      : request;
    const { result } = await this.runWithFallback("tts", context, (provider, modelId) => {
      if (!provider.synthesizeSpeech)
        throw new Error(
          `provider "${provider.id}" declared TTS support but has no synthesizeSpeech()`,
        );
      return provider.synthesizeSpeech(modelId, enrichedRequest);
    });
    return result;
  }

  async describeImage(request: VisionRequest, context: InferenceContext): Promise<VisionResult> {
    const { result } = await this.runWithFallback("vision", context, (provider, modelId) => {
      if (!provider.describeImage)
        throw new Error(
          `provider "${provider.id}" declared vision support but has no describeImage()`,
        );
      return provider.describeImage(modelId, request);
    });
    return result;
  }

  async editImage(request: ImageEditRequest, context: InferenceContext): Promise<ImageEditResult> {
    const { result } = await this.runWithFallback("image-editing", context, (provider, modelId) => {
      if (!provider.editImage)
        throw new Error(
          `provider "${provider.id}" declared image-editing support but has no editImage()`,
        );
      return provider.editImage(modelId, request);
    });
    return result;
  }

  /**
   * Streaming chat is handled separately from `runWithFallback` because a
   * mid-stream failure (some tokens already delivered) must not silently
   * retry against a second provider — same rule the Core AI Engine's
   * orchestrator applies to cloud providers, applied here for local ones.
   * If every local candidate fails before yielding anything and a cloud
   * fallback was configured, this hands off to it as a last resort.
   */
  async *streamChat(
    request: ProviderChatRequest,
    context: InferenceContext,
  ): AsyncIterable<StreamEvent> {
    const candidates = await this.findCandidates("chat", context);
    const attempts: string[] = [];

    for (const candidate of candidates) {
      if (!candidate.provider.streamChat) continue;
      const startedAt = Date.now();
      try {
        const iterator = candidate.provider
          .streamChat(candidate.runtimeModelId, request)
          [Symbol.asyncIterator]();
        const first = await iterator.next();
        this.options.healthMonitor.recordSuccess(candidate.provider.id, Date.now() - startedAt);
        this.options.cache.recordUse(candidate.modelId);

        if (!first.done) yield first.value;
        let next = first.done ? first : await iterator.next();
        while (!next.done) {
          yield next.value;
          next = await iterator.next();
        }
        return;
      } catch (err) {
        this.options.healthMonitor.recordFailure(candidate.provider.id);
        attempts.push(`${candidate.provider.id}: ${String(err)}`);
      }
    }

    const canTryCloud = this.options.cloudChatFallback && (await this.isCloudReachable());
    if (canTryCloud && this.options.cloudChatFallback) {
      log.info("all local chat providers unavailable, falling back to cloud", { attempts });
      void this.options.eventBus?.emit(
        "local_runtime.fallback_to_cloud",
        { attempts },
        "local-runtime",
      );
      yield* this.options.cloudChatFallback.streamChat(request);
      return;
    }

    if (candidates.length === 0) throw new MissingModelError("chat");
    throw new AllProvidersFailedError("chat", attempts);
  }

  /** No detector injected means "assume reachable" — the cloud provider's own request will fail fast if not. */
  private async isCloudReachable(): Promise<boolean> {
    if (!this.options.offlineStatus) return true;
    return this.options.offlineStatus.isOnline();
  }

  /**
   * Wraps this manager's model-selection + runtime-fallback chat logic
   * into a single object satisfying `@ryper/ai-engine`'s `AIProvider`
   * interface. Register the result with the Core AI Engine's
   * `ProviderRegistry` and it never needs to know llama.cpp, Ollama,
   * ONNX, or MLX exist.
   */
  toAIProvider(id: string, defaultContext: InferenceContext): AIProvider {
    return {
      id,
      kind: "local",
      streamChat: (request) => this.streamChat(request, defaultContext),
    };
  }
}

export function createLocalRuntimeManager(
  options: LocalRuntimeManagerOptions,
): LocalRuntimeManager {
  return new LocalRuntimeManager(options);
}
