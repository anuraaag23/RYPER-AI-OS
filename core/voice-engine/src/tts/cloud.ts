import { assertOk, type HttpFetch } from "@ryper/ai-engine";
import type { TtsAudioChunk, TtsRequestOptions, VoiceProfile } from "../types.js";
import type { SpeechSynthesisProvider } from "./types.js";

export interface CloudTtsConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly mimeType?: string;
}

/**
 * Streams raw audio bytes back from a cloud TTS endpoint as they arrive —
 * unlike the STT cloud adapter (which parses SSE-framed JSON events), TTS
 * responses are the audio bytes themselves, so this reads
 * `response.body()` directly rather than through an SSE/NDJSON parser.
 */
export class CloudSpeechSynthesisProvider implements SpeechSynthesisProvider {
  readonly id: string;
  readonly supportsOffline = false;

  constructor(
    private readonly config: CloudTtsConfig,
    private readonly httpFetch: HttpFetch,
    readonly voices: readonly VoiceProfile[],
  ) {
    this.id = config.id;
  }

  async *synthesizeStream(
    text: string,
    options: TtsRequestOptions = {},
  ): AsyncIterable<TtsAudioChunk> {
    const response = await this.httpFetch(`${this.config.baseUrl}/v1/text:synthesize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        text,
        voiceId: options.voiceId,
        speed: options.speed ?? 1,
        pitch: options.pitch ?? 1,
        emotion: options.emotion,
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    await assertOk(response);

    const body = response.body();
    if (!body) {
      throw new Error("cloud TTS response had no streamable body");
    }
    const mimeType = this.config.mimeType ?? "audio/mpeg";
    for await (const bytes of body) {
      yield { bytes, mimeType };
    }
  }
}

export function createCloudSpeechSynthesisProvider(
  config: CloudTtsConfig,
  httpFetch: HttpFetch,
  voices: readonly VoiceProfile[],
): CloudSpeechSynthesisProvider {
  return new CloudSpeechSynthesisProvider(config, httpFetch, voices);
}
