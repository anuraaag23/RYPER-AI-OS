import type { AudioFrame, SttEvent, SttRequestOptions } from "../types.js";

export interface SpeechRecognitionProvider {
  readonly id: string;
  readonly supportsOffline: boolean;
  /** Consumes captured audio frames and yields partial/final transcription events as they become available. */
  streamRecognize(
    audio: AsyncIterable<AudioFrame>,
    options?: SttRequestOptions,
  ): AsyncIterable<SttEvent>;
}
