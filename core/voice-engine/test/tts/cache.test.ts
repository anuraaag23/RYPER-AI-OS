import { describe, expect, it, vi } from "vitest";
import { VoiceCache, synthesizeWithCache } from "../../src/tts/cache.js";
import type { TtsAudioChunk } from "../../src/types.js";

async function collect(iter: AsyncIterable<TtsAudioChunk>): Promise<TtsAudioChunk[]> {
  const out: TtsAudioChunk[] = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

describe("VoiceCache", () => {
  it("distinguishes cache entries by voice/speed/pitch, not just text", () => {
    const cache = new VoiceCache();
    cache.set("hi", { voiceId: "a" }, [{ bytes: new Uint8Array([1]), mimeType: "audio/wav" }]);
    expect(cache.has("hi", { voiceId: "a" })).toBe(true);
    expect(cache.has("hi", { voiceId: "b" })).toBe(false);
  });

  it("evicts the oldest entry once maxEntries is exceeded", () => {
    const cache = new VoiceCache(1);
    cache.set("first", {}, [{ bytes: new Uint8Array(), mimeType: "audio/wav" }]);
    cache.set("second", {}, [{ bytes: new Uint8Array(), mimeType: "audio/wav" }]);
    expect(cache.has("first")).toBe(false);
    expect(cache.has("second")).toBe(true);
  });

  it("clear() empties the cache", () => {
    const cache = new VoiceCache();
    cache.set("hi", {}, [{ bytes: new Uint8Array(), mimeType: "audio/wav" }]);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});

describe("synthesizeWithCache", () => {
  it("calls the synthesizer once, then serves from cache on repeat calls", async () => {
    const cache = new VoiceCache();
    const synthesize = vi.fn(async function* (): AsyncGenerator<TtsAudioChunk> {
      yield { bytes: new Uint8Array([9]), mimeType: "audio/wav" };
    });

    const first = await collect(synthesizeWithCache(cache, "hello", {}, synthesize));
    const second = await collect(synthesizeWithCache(cache, "hello", {}, synthesize));

    expect(first).toEqual(second);
    expect(synthesize).toHaveBeenCalledTimes(1);
  });
});
