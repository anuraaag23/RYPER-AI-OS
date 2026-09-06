import { assertOk, parseSSEStream, type HttpFetch } from "@ryper/ai-engine";
import type { AudioFrame, SttEvent, SttRequestOptions } from "../types.js";
import type { SpeechRecognitionProvider } from "./types.js";

export interface CloudSttConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

interface CloudSttChunk {
  readonly type: "partial" | "final";
  readonly text: string;
  readonly confidence?: number;
  readonly language?: string;
}

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
 * Uploads the captured utterance as one request (the `HttpFetch`
 * abstraction this codebase uses is single-request/single-response, not
 * full-duplex websocket) and streams the transcription result back over
 * SSE using `@ryper/ai-engine`'s existing parser — mirroring how several
 * real cloud STT providers support "upload full audio, get incremental
 * results back" as an alternative to a websocket session.
 */
export class CloudSpeechRecognitionProvider implements SpeechRecognitionProvider {
  readonly id: string;
  readonly supportsOffline = false;

  constructor(
    private readonly config: CloudSttConfig,
    private readonly httpFetch: HttpFetch,
  ) {
    this.id = config.id;
  }

  async *streamRecognize(
    audio: AsyncIterable<AudioFrame>,
    options: SttRequestOptions = {},
  ): AsyncIterable<SttEvent> {
    const frames: AudioFrame[] = [];
    for await (const frame of audio) {
      if (options.signal?.aborted) return;
      frames.push(frame);
    }
    if (frames.length === 0) {
      yield { type: "error", message: "no audio captured" };
      return;
    }

    const sampleRateHz = frames[0]!.sampleRateHz;
    const audioBytes = concatFrames(frames);
    const base64Audio = Buffer.from(audioBytes).toString("base64");

    const response = await this.httpFetch(`${this.config.baseUrl}/v1/speech:streamingRecognize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        audio: base64Audio,
        sampleRateHz,
        languageHint: options.languageHint,
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    await assertOk(response);

    const body = response.body();
    if (!body) {
      yield { type: "error", message: "cloud STT response had no streamable body" };
      return;
    }

    for await (const message of parseSSEStream(body)) {
      const chunk = JSON.parse(message.data) as CloudSttChunk;
      if (chunk.type === "partial") {
        yield { type: "partial", text: chunk.text, confidence: chunk.confidence ?? 0.5 };
      } else {
        yield {
          type: "final",
          text: chunk.text,
          confidence: chunk.confidence ?? 1,
          ...(chunk.language ? { language: chunk.language } : {}),
        };
      }
    }
  }
}

export function createCloudSpeechRecognitionProvider(
  config: CloudSttConfig,
  httpFetch: HttpFetch,
): CloudSpeechRecognitionProvider {
  return new CloudSpeechRecognitionProvider(config, httpFetch);
}
