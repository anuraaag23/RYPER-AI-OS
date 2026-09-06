import type { LocalRuntimeManager, InferenceContext } from "@ryper/local-runtime";
import type { TtsAudioChunk, TtsRequestOptions, VoiceProfile } from "../types.js";
import type { SpeechSynthesisProvider } from "./types.js";
import { chunkForSpeech } from "./sentence-splitter.js";

/**
 * Wraps `@ryper/local-runtime`'s `LocalRuntimeManager.synthesizeSpeech()`
 * (Phase 4). As of Phase 13.7, `text` is split into sentence-sized pieces
 * (`chunkForSpeech`) and each is synthesized and yielded as its own
 * `TtsAudioChunk` — real sentence-level pipelining: `SpeakerManager.play()`
 * (Phase 13.6) already pulls chunks via `for await` and schedules each
 * for gapless playback as soon as it arrives, so the first sentence can
 * start playing while later sentences are still being synthesized,
 * instead of the whole response being one blocking synthesis call. This
 * is NOT token-level streaming (the full AI response text is already in
 * hand before this runs) and is never described as such — see
 * `docs/PROJECT_STATE.md`'s Phase 13.7 section. `options.signal` is
 * checked between sentences so an interruption stops queuing further
 * synthesis calls promptly, not just future playback.
 */
export class LocalSpeechSynthesisProvider implements SpeechSynthesisProvider {
  readonly id = "local-runtime-tts";
  readonly supportsOffline = true;

  constructor(
    private readonly runtimeManager: LocalRuntimeManager,
    private readonly inferenceContext: InferenceContext,
    readonly voices: readonly VoiceProfile[],
  ) {}

  async *synthesizeStream(
    text: string,
    options: TtsRequestOptions = {},
  ): AsyncIterable<TtsAudioChunk> {
    const sentences = chunkForSpeech(text);
    for (const sentence of sentences) {
      if (options.signal?.aborted) return;
      const isHindi = options.voiceId === "hindi" || /[\u0900-\u097F]/.test(sentence);
      const result = await this.runtimeManager.synthesizeSpeech(
        { text: sentence, ...(options.voiceId ? { voice: options.voiceId } : {}) },
        {
          ...this.inferenceContext,
          ...(isHindi ? { preferredModelId: "piper-hindi-local" } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        },
      );
      yield { bytes: result.audioBytes, mimeType: "audio/wav" };
    }
  }
}

export function createLocalSpeechSynthesisProvider(
  runtimeManager: LocalRuntimeManager,
  inferenceContext: InferenceContext,
  voices: readonly VoiceProfile[],
): LocalSpeechSynthesisProvider {
  return new LocalSpeechSynthesisProvider(runtimeManager, inferenceContext, voices);
}
