import { describe, expect, it } from "vitest";
import type { HttpFetch, HttpResponseLike } from "@ryper/ai-engine";
import { CloudSpeechRecognitionProvider } from "../../src/stt/cloud.js";
import { toneFrame } from "../fixtures.js";
import type { SttEvent } from "../../src/types.js";

async function* toByteChunks(text: string): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  yield bytes;
}

function fakeFetch(bodyText: string): HttpFetch {
  return async (): Promise<HttpResponseLike> => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => bodyText,
    body: () => toByteChunks(bodyText),
  });
}

async function collect(iter: AsyncIterable<SttEvent>): Promise<SttEvent[]> {
  const out: SttEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

async function* frames(n: number) {
  for (let i = 0; i < n; i++) yield toneFrame(1000);
}

describe("CloudSpeechRecognitionProvider", () => {
  it("streams partial and final events parsed from SSE", async () => {
    const body = [
      'data: {"type":"partial","text":"hel","confidence":0.4}',
      'data: {"type":"final","text":"hello","confidence":0.95,"language":"en-US"}',
      "",
    ].join("\n\n");

    const provider = new CloudSpeechRecognitionProvider(
      { id: "cloud-stt", baseUrl: "https://stt.example.com", apiKey: "key" },
      fakeFetch(body),
    );
    const events = await collect(provider.streamRecognize(frames(2)));
    expect(events).toEqual([
      { type: "partial", text: "hel", confidence: 0.4 },
      { type: "final", text: "hello", confidence: 0.95, language: "en-US" },
    ]);
  });

  it("errors out when no audio was captured", async () => {
    const provider = new CloudSpeechRecognitionProvider(
      { id: "cloud-stt", baseUrl: "https://stt.example.com", apiKey: "key" },
      fakeFetch(""),
    );
    const events = await collect(provider.streamRecognize(frames(0)));
    expect(events).toEqual([{ type: "error", message: "no audio captured" }]);
  });

  it("reports itself as not offline-capable", () => {
    const provider = new CloudSpeechRecognitionProvider(
      { id: "cloud-stt", baseUrl: "https://stt.example.com", apiKey: "key" },
      fakeFetch(""),
    );
    expect(provider.supportsOffline).toBe(false);
  });
});
