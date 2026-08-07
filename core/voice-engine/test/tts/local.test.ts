import { describe, expect, it } from "vitest";
import type { LocalRuntimeManager, InferenceContext, TTSResult } from "@ryper/local-runtime";
import { LocalSpeechSynthesisProvider } from "../../src/tts/local.js";
import type { TtsAudioChunk } from "../../src/types.js";

function fakeRuntimeManager(result: TTSResult): LocalRuntimeManager {
  return { synthesizeSpeech: async () => result } as unknown as LocalRuntimeManager;
}

async function collect(iter: AsyncIterable<TtsAudioChunk>): Promise<TtsAudioChunk[]> {
  const out: TtsAudioChunk[] = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

const context: InferenceContext = { device: { online: false } };

describe("LocalSpeechSynthesisProvider", () => {
  it("yields the synthesized audio as a single chunk", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const provider = new LocalSpeechSynthesisProvider(
      fakeRuntimeManager({ audioBytes: bytes }),
      context,
      [{ id: "default", name: "Default", language: "en-US" }],
    );
    const chunks = await collect(provider.synthesizeStream("hello"));
    expect(chunks).toEqual([{ bytes, mimeType: "audio/wav" }]);
  });

  it("reports itself as offline-capable and exposes configured voices", () => {
    const provider = new LocalSpeechSynthesisProvider(
      fakeRuntimeManager({ audioBytes: new Uint8Array() }),
      context,
      [{ id: "v1", name: "Voice One", language: "en-US" }],
    );
    expect(provider.supportsOffline).toBe(true);
    expect(provider.voices).toHaveLength(1);
  });
});
