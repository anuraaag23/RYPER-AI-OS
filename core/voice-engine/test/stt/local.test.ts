import { describe, expect, it } from "vitest";
import type { LocalRuntimeManager, InferenceContext, ASRResult } from "@ryper/local-runtime";
import { LocalSpeechRecognitionProvider } from "../../src/stt/local.js";
import { toneFrame } from "../fixtures.js";
import type { SttEvent } from "../../src/types.js";

function fakeRuntimeManager(result: ASRResult | Error): LocalRuntimeManager {
  return {
    transcribe: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as LocalRuntimeManager;
}

async function collect(iter: AsyncIterable<SttEvent>): Promise<SttEvent[]> {
  const out: SttEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

const context: InferenceContext = { device: { online: false } };

async function* frames(n: number) {
  for (let i = 0; i < n; i++) yield toneFrame(1000);
}

describe("LocalSpeechRecognitionProvider", () => {
  it("buffers all frames then emits a single final event", async () => {
    const runtimeManager = fakeRuntimeManager({ text: "hello world" });
    const provider = new LocalSpeechRecognitionProvider(runtimeManager, context);
    const events = await collect(provider.streamRecognize(frames(3)));
    expect(events).toEqual([{ type: "final", text: "hello world", confidence: 1 }]);
  });

  it("emits an error event when no audio was captured", async () => {
    const runtimeManager = fakeRuntimeManager({ text: "" });
    const provider = new LocalSpeechRecognitionProvider(runtimeManager, context);
    const events = await collect(provider.streamRecognize(frames(0)));
    expect(events).toEqual([{ type: "error", message: "no audio captured" }]);
  });

  it("emits an error event when transcription fails", async () => {
    const runtimeManager = fakeRuntimeManager(new Error("model crashed"));
    const provider = new LocalSpeechRecognitionProvider(runtimeManager, context);
    const events = await collect(provider.streamRecognize(frames(1)));
    expect(events[0]?.type).toBe("error");
  });

  it("reports itself as offline-capable", () => {
    const provider = new LocalSpeechRecognitionProvider(fakeRuntimeManager({ text: "" }), context);
    expect(provider.supportsOffline).toBe(true);
  });
});
