import { describe, expect, it, vi } from "vitest";
import { SpeechSynthesisRegistry } from "../../src/tts/registry.js";
import type { SpeechSynthesisProvider } from "../../src/tts/types.js";
import type { TtsAudioChunk } from "../../src/types.js";

function fakeProvider(
  id: string,
  supportsOffline: boolean,
  synth: () => AsyncGenerator<TtsAudioChunk>,
): SpeechSynthesisProvider {
  return { id, supportsOffline, voices: [], synthesizeStream: synth };
}

async function collect(iter: AsyncIterable<TtsAudioChunk>): Promise<TtsAudioChunk[]> {
  const out: TtsAudioChunk[] = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

describe("SpeechSynthesisRegistry", () => {
  it("selects per offline/cloud preference the same way STT does", () => {
    const registry = new SpeechSynthesisRegistry();
    registry.register(fakeProvider("local", true, async function* () {}));
    registry.register(fakeProvider("cloud", false, async function* () {}));
    expect(registry.select("offline_only", true).id).toBe("local");
    expect(registry.select("prefer_cloud", true).id).toBe("cloud");
  });

  it("synthesize() routes through the selected provider and caches the result", async () => {
    const synth = vi.fn(async function* (): AsyncGenerator<TtsAudioChunk> {
      yield { bytes: new Uint8Array([1]), mimeType: "audio/wav" };
    });
    const registry = new SpeechSynthesisRegistry();
    registry.register(fakeProvider("local", true, synth));

    await collect(registry.synthesize("offline_only", true, "hello"));
    await collect(registry.synthesize("offline_only", true, "hello"));
    expect(synth).toHaveBeenCalledTimes(1);
  });

  it("listVoices aggregates voices across providers with their owning provider id", () => {
    const registry = new SpeechSynthesisRegistry();
    registry.register({
      id: "local",
      supportsOffline: true,
      voices: [{ id: "v1", name: "Voice 1", language: "en-US" }],
      synthesizeStream: async function* () {},
    });
    expect(registry.listVoices()).toEqual([
      { providerId: "local", voice: { id: "v1", name: "Voice 1", language: "en-US" } },
    ]);
  });
});
