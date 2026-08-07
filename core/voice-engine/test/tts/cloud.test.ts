import { describe, expect, it } from "vitest";
import type { HttpFetch, HttpResponseLike } from "@ryper/ai-engine";
import { CloudSpeechSynthesisProvider } from "../../src/tts/cloud.js";
import type { TtsAudioChunk } from "../../src/types.js";

function fakeFetch(chunks: Uint8Array[]): HttpFetch {
  return async (): Promise<HttpResponseLike> => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
    body: () =>
      (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
  });
}

async function collect(iter: AsyncIterable<TtsAudioChunk>): Promise<TtsAudioChunk[]> {
  const out: TtsAudioChunk[] = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

describe("CloudSpeechSynthesisProvider", () => {
  it("streams raw audio byte chunks as they arrive", async () => {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
    const provider = new CloudSpeechSynthesisProvider(
      { id: "cloud-tts", baseUrl: "https://tts.example.com", apiKey: "key" },
      fakeFetch(chunks),
      [{ id: "v1", name: "Voice", language: "en-US" }],
    );
    const result = await collect(provider.synthesizeStream("hello"));
    expect(result).toEqual([
      { bytes: chunks[0], mimeType: "audio/mpeg" },
      { bytes: chunks[1], mimeType: "audio/mpeg" },
    ]);
  });

  it("uses a configured mime type override", async () => {
    const provider = new CloudSpeechSynthesisProvider(
      { id: "cloud-tts", baseUrl: "https://tts.example.com", apiKey: "key", mimeType: "audio/wav" },
      fakeFetch([new Uint8Array([1])]),
      [],
    );
    const result = await collect(provider.synthesizeStream("hi"));
    expect(result[0]?.mimeType).toBe("audio/wav");
  });

  it("reports itself as not offline-capable", () => {
    const provider = new CloudSpeechSynthesisProvider(
      { id: "cloud-tts", baseUrl: "https://tts.example.com", apiKey: "key" },
      fakeFetch([]),
      [],
    );
    expect(provider.supportsOffline).toBe(false);
  });
});
