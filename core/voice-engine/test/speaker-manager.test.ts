import { describe, expect, it, vi } from "vitest";
import { AudioDeviceManager, type AudioDeviceSource } from "../src/audio-device-manager.js";
import { SpeakerManager, type AudioPlaybackSink } from "../src/speaker-manager.js";
import { sampleDevice } from "./fixtures.js";
import type { TtsAudioChunk } from "../src/types.js";

async function* chunks(n: number): AsyncGenerator<TtsAudioChunk> {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setTimeout(r, 5));
    yield { bytes: new Uint8Array([i]), mimeType: "audio/wav" };
  }
}

function buildManager() {
  const source: AudioDeviceSource = {
    listDevices: async () => [sampleDevice({ id: "spk-1", kind: "speaker" })],
    hasPermission: async () => true,
    requestPermission: async () => true,
  };
  const deviceManager = new AudioDeviceManager(source);
  const sink: AudioPlaybackSink = {
    play: async (_deviceId, chunkStream, signal) => {
      for await (const _chunk of chunkStream) {
        if (signal.aborted) return;
      }
    },
    setVolume: async () => {},
  };
  return { deviceManager, speaker: new SpeakerManager(deviceManager, sink) };
}

describe("SpeakerManager", () => {
  it("throws if no speaker device is available", async () => {
    const { speaker } = buildManager();
    await expect(speaker.play(chunks(1))).rejects.toThrow(/no speaker/);
  });

  it("plays through the sink once a device is available", async () => {
    const { deviceManager, speaker } = buildManager();
    await deviceManager.refresh();
    await expect(speaker.play(chunks(2))).resolves.toBeUndefined();
    expect(speaker.isSpeaking()).toBe(false);
  });

  it("interrupt() aborts an in-progress playback (barge-in)", async () => {
    const { deviceManager, speaker } = buildManager();
    await deviceManager.refresh();
    const playPromise = speaker.play(chunks(20));
    await new Promise((r) => setTimeout(r, 10));
    expect(speaker.isSpeaking()).toBe(true);
    speaker.interrupt();
    await playPromise;
    expect(speaker.isSpeaking()).toBe(false);
  });

  it("starting a new play() interrupts whatever was already playing", async () => {
    const { deviceManager, speaker } = buildManager();
    await deviceManager.refresh();
    const first = speaker.play(chunks(20));
    await new Promise((r) => setTimeout(r, 10));
    const second = speaker.play(chunks(1));
    await Promise.all([first, second]);
    expect(speaker.isSpeaking()).toBe(false);
  });

  it("setVolume() clamps to 0..1 and delegates to the sink", async () => {
    const { deviceManager } = buildManager();
    await deviceManager.refresh();
    const setVolume = vi.fn(async () => {});
    const speaker2 = new SpeakerManager(deviceManager, { play: async () => {}, setVolume });
    await speaker2.setVolume(1.5);
    expect(speaker2.getVolume()).toBe(1);
    expect(setVolume).toHaveBeenCalledWith("spk-1", 1);
  });
});
