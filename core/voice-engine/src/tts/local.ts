import type { LocalRuntimeManager, InferenceContext } from "@ryper/local-runtime";
import type { TtsAudioChunk, TtsRequestOptions, VoiceProfile } from "../types.js";
import type { SpeechSynthesisProvider } from "./types.js";

/**
 * Wraps `@ryper/local-runtime`'s `LocalRuntimeManager.synthesizeSpeech()`
 * (Phase 4). Like its STT counterpart, the underlying call is single-shot
 * (full text in, full audio out) — this adapter yields the result as one
 * chunk. Real streaming synthesis (audio starting to play before the full
 * utterance is generated) needs a runtime provider that yields audio
 * incrementally; swapping one in later requires no change to callers of
 * `SpeechSynthesisProvider`.
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
    const result = await this.runtimeManager.synthesizeSpeech(
      { text, ...(options.voiceId ? { voice: options.voiceId } : {}) },
      { ...this.inferenceContext, ...(options.signal ? { signal: options.signal } : {}) },
    );
    yield { bytes: result.audioBytes, mimeType: "audio/wav" };
  }
}

export function createLocalSpeechSynthesisProvider(
  runtimeManager: LocalRuntimeManager,
  inferenceContext: InferenceContext,
  voices: readonly VoiceProfile[],
): LocalSpeechSynthesisProvider {
  return new LocalSpeechSynthesisProvider(runtimeManager, inferenceContext, voices);
}
