import type { TtsAudioChunk, TtsRequestOptions, VoiceProfile } from "../types.js";

export interface SpeechSynthesisProvider {
  readonly id: string;
  readonly supportsOffline: boolean;
  readonly voices: readonly VoiceProfile[];
  synthesizeStream(text: string, options?: TtsRequestOptions): AsyncIterable<TtsAudioChunk>;
}
