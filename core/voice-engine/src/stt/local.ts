import type { LocalRuntimeManager, InferenceContext } from "@ryper/local-runtime";
import type { AudioFrame, SttEvent, SttRequestOptions } from "../types.js";
import type { SpeechRecognitionProvider } from "./types.js";

function concatFrames(frames: readonly AudioFrame[]): Uint8Array {
  const totalSamples = frames.reduce((sum, f) => sum + f.samples.length, 0);
  const bytes = new Uint8Array(totalSamples * 2);
  let offset = 0;
  for (const frame of frames) {
    for (const sample of frame.samples) {
      bytes[offset] = sample & 0xff;
      bytes[offset + 1] = (sample >> 8) & 0xff;
      offset += 2;
    }
  }
  return bytes;
}

/**
 * Wraps `@ryper/local-runtime`'s `LocalRuntimeManager.transcribe()`
 * (Phase 4) rather than reimplementing an ASR pipeline. Honest limitation:
 * `transcribe()` is single-shot (full audio in, full text out), so this
 * adapter buffers the entire captured utterance and emits one `final`
 * event when the input stream ends — it does not emit `partial` events.
 * True incremental streaming ASR needs a runtime provider whose adapter
 * exposes partial results (a future `@ryper/local-runtime` addition); this
 * class can be swapped for that without any change to callers, since it
 * satisfies the same `SpeechRecognitionProvider` interface either way.
 */
export class LocalSpeechRecognitionProvider implements SpeechRecognitionProvider {
  readonly id = "local-runtime-stt";
  readonly supportsOffline = true;

  constructor(
    private readonly runtimeManager: LocalRuntimeManager,
    private readonly inferenceContext: InferenceContext,
  ) {}

  async *streamRecognize(
    audio: AsyncIterable<AudioFrame>,
    options: SttRequestOptions = {},
  ): AsyncIterable<SttEvent> {
    const frames: AudioFrame[] = [];
    try {
      for await (const frame of audio) {
        if (options.signal?.aborted) return;
        frames.push(frame);
      }
    } catch (err) {
      yield { type: "error", message: `audio capture failed: ${String(err)}` };
      return;
    }

    if (frames.length === 0) {
      yield { type: "error", message: "no audio captured" };
      return;
    }

    try {
      const result = await this.runtimeManager.transcribe(
        { audioBytes: concatFrames(frames) },
        { ...this.inferenceContext, ...(options.signal ? { signal: options.signal } : {}) },
      );
      yield {
        type: "final",
        text: result.text,
        confidence: 1,
        ...(options.languageHint ? { language: options.languageHint } : {}),
      };
    } catch (err) {
      yield { type: "error", message: `local transcription failed: ${String(err)}` };
    }
  }
}

export function createLocalSpeechRecognitionProvider(
  runtimeManager: LocalRuntimeManager,
  inferenceContext: InferenceContext,
): LocalSpeechRecognitionProvider {
  return new LocalSpeechRecognitionProvider(runtimeManager, inferenceContext);
}
