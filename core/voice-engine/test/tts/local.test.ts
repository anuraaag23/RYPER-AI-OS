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

  it("Phase 13.7: splits a multi-sentence response into one chunk per sentence, calling synthesizeSpeech once per sentence", async () => {
    const calls: string[] = [];
    const runtimeManager = {
      synthesizeSpeech: async (request: { text: string }) => {
        calls.push(request.text);
        return { audioBytes: new TextEncoder().encode(request.text) };
      },
    } as unknown as LocalRuntimeManager;

    const provider = new LocalSpeechSynthesisProvider(runtimeManager, context, []);
    const chunks = await collect(
      provider.synthesizeStream("Your meeting is at ten AM. Don't be late! Any questions?"),
    );

    expect(calls).toEqual(["Your meeting is at ten AM.", "Don't be late!", "Any questions?"]);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.mimeType === "audio/wav")).toBe(true);
  });

  it("Phase 13.7: yields each sentence's chunk as soon as it's synthesized, not after the whole response — real pipelining, not batching", async () => {
    let call = 0;
    const runtimeManager = {
      synthesizeSpeech: async () => {
        call += 1;
        return { audioBytes: new Uint8Array([call]) };
      },
    } as unknown as LocalRuntimeManager;

    const provider = new LocalSpeechSynthesisProvider(runtimeManager, context, []);
    const iterator = provider
      .synthesizeStream(
        "This is the first sentence of the response. This is the second sentence of the response.",
      )
      [Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value?.bytes).toEqual(new Uint8Array([1]));
    expect(call).toBe(1); // the second sentence has not been synthesized yet

    const second = await iterator.next();
    expect(second.value?.bytes).toEqual(new Uint8Array([2]));
    expect(call).toBe(2);
  });

  it("Phase 13.7: stops synthesizing further sentences once the signal is aborted between sentences", async () => {
    let call = 0;
    const runtimeManager = {
      synthesizeSpeech: async () => {
        call += 1;
        return { audioBytes: new Uint8Array([call]) };
      },
    } as unknown as LocalRuntimeManager;

    const controller = new AbortController();
    const provider = new LocalSpeechSynthesisProvider(runtimeManager, context, []);
    const iterator = provider
      .synthesizeStream(
        "This is the first sentence of the response. This is the second sentence of the response.",
        { signal: controller.signal },
      )
      [Symbol.asyncIterator]();

    await iterator.next(); // first sentence synthesized
    controller.abort();
    const next = await iterator.next();

    expect(next.done).toBe(true);
    expect(call).toBe(1); // the second sentence was never requested
  });
});
