import { describe, expect, it } from "vitest";
import { AudioDeviceManager, type AudioDeviceSource } from "../src/audio-device-manager.js";
import { MicrophoneManager, type AudioCaptureSource } from "../src/microphone-manager.js";
import { sampleDevice, silentFrame, collectFrames } from "./fixtures.js";

function buildManager(frameCount = 3) {
  const source: AudioDeviceSource = {
    listDevices: async () => [sampleDevice()],
    hasPermission: async () => true,
    requestPermission: async () => true,
  };
  const deviceManager = new AudioDeviceManager(source);
  const captureSource: AudioCaptureSource = {
    startCapture: async function* () {
      for (let i = 0; i < frameCount; i++) yield silentFrame();
    },
  };
  return { deviceManager, mic: new MicrophoneManager(deviceManager, captureSource) };
}

describe("MicrophoneManager", () => {
  it("throws if no microphone device is available", async () => {
    const { mic } = buildManager();
    await expect(collectFrames(mic.startCapture())).rejects.toThrow(/no microphone/);
  });

  it("streams frames from the capture source once a device is selected", async () => {
    const { deviceManager, mic } = buildManager(3);
    await deviceManager.refresh();
    const frames = await collectFrames(mic.startCapture());
    expect(frames).toHaveLength(3);
  });

  it("rejects a sample rate the device doesn't support", async () => {
    const { deviceManager, mic } = buildManager();
    await deviceManager.refresh();
    await expect(collectFrames(mic.startCapture(8000))).rejects.toThrow(/does not support/);
  });

  it("refuses to start a second concurrent capture", async () => {
    const { deviceManager, mic } = buildManager(50);
    await deviceManager.refresh();
    const first = mic.startCapture();
    const iterator = first[Symbol.asyncIterator]();
    await iterator.next(); // start iterating so isCapturing() becomes true

    expect(mic.isCapturing()).toBe(true);
    expect(() => mic.startCapture()).not.toThrow(); // generator fn itself doesn't throw until iterated
    await expect(collectFrames(mic.startCapture())).rejects.toThrow(/already active/);
  });

  it("stopCapture() halts an in-progress stream", async () => {
    const { deviceManager, mic } = buildManager(1000);
    await deviceManager.refresh();
    const frames: unknown[] = [];
    const gen = mic.startCapture();
    for await (const frame of gen) {
      frames.push(frame);
      if (frames.length === 2) mic.stopCapture();
    }
    expect(frames.length).toBeLessThan(1000);
  });
});
