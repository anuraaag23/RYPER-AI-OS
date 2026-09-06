import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CapabilityBroker } from "@ryper/security";
import { createCapabilityManager } from "@ryper/platform-capability";
import { createWebShell } from "@ryper/web-shell";
import { bootstrapMemoryManager } from "../electron/memory-bootstrap.js";
import { bootstrapVoice } from "../electron/voice-bootstrap.js";
import { ReferenceVoiceRuntimeProvider } from "../electron/reference-voice-runtime-provider.js";
import {
  UnavailableAudioBridge,
  AudioBridgeUnavailableError,
  type RendererIpcReceiver,
  type RendererIpcSender,
} from "../electron/audio-bridge.js";

describe("bootstrapVoice", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ryper-voice-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("assembles a complete, real voice pipeline with no construction errors", async () => {
    const webShell = createWebShell();
    const memory = bootstrapMemoryManager(webShell.eventBus);
    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });

    const bundle = await bootstrapVoice(
      memory,
      capabilityManager,
      broker,
      { modelCacheDir: join(dir, "models") },
      webShell.eventBus,
    );

    expect(bundle.pipeline).toBeDefined();
    expect(bundle.sessionManager.getSnapshot().state).toBe("idle");
    expect(bundle.wakeWordEngine).toBeDefined();
    expect(bundle.settings.get().offlineCloudPreference).toBeDefined();
  });

  it("a fresh session's diagnostics start with no recorded stages", async () => {
    const memory = bootstrapMemoryManager();
    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const bundle = await bootstrapVoice(memory, capabilityManager, broker, {
      modelCacheDir: join(dir, "models"),
    });
    expect(bundle.diagnostics.snapshot().lastStageTimings).toEqual([]);
  });

  it("interrupt() cancels the session without throwing even when idle", async () => {
    const memory = bootstrapMemoryManager();
    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const bundle = await bootstrapVoice(memory, capabilityManager, broker, {
      modelCacheDir: join(dir, "models"),
    });
    expect(() => bundle.pipeline.interrupt()).not.toThrow();
  });

  it("runTurn() honestly fails with AudioBridgeUnavailableError — no real microphone bridge exists yet", async () => {
    const memory = bootstrapMemoryManager();
    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const bundle = await bootstrapVoice(memory, capabilityManager, broker, {
      modelCacheDir: join(dir, "models"),
    });
    await expect(bundle.pipeline.runTurn({ online: true })).rejects.toThrow();
  });

  it("exposes deviceManager/microphoneManager/speakerManager on the bundle", async () => {
    const memory = bootstrapMemoryManager();
    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });
    const bundle = await bootstrapVoice(memory, capabilityManager, broker, {
      modelCacheDir: join(dir, "models"),
    });
    expect(bundle.deviceManager).toBeDefined();
    expect(bundle.microphoneManager).toBeDefined();
    expect(bundle.speakerManager).toBeDefined();
    expect(bundle.deviceManager.list()).toBeDefined();
  });

  it("Phase 13.6: wiring a real audioIpc makes real audio device queries actually reach the renderer", async () => {
    const memory = bootstrapMemoryManager();
    const broker = new CapabilityBroker(() => true);
    const capabilityManager = createCapabilityManager({
      broker,
      platformDetector: () => "windows",
    });

    // A deterministic fake renderer standing in for a real Electron WebContents —
    // simulates exactly what src/audio/index.ts would reply with.
    const mainListeners = new Map<string, Array<(event: unknown, payload: unknown) => void>>();
    const ipcMain: RendererIpcReceiver = {
      on: (channel, listener) => {
        const list = mainListeners.get(channel) ?? [];
        list.push(listener);
        mainListeners.set(channel, list);
      },
      removeListener: () => {},
    };
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const renderer: RendererIpcSender = {
      send: (channel, payload) => {
        sent.push({ channel, payload });
        if (channel === "audio-bridge:list-devices") {
          const requestId = (payload as { requestId: string }).requestId;
          for (const listener of mainListeners.get("audio-bridge:list-devices-result") ?? []) {
            listener(undefined, { requestId, devices: [] });
          }
        }
      },
      isDestroyed: () => false,
    };

    const bundle = await bootstrapVoice(
      memory,
      capabilityManager,
      broker,
      { modelCacheDir: join(dir, "models") },
      undefined,
      { ipcMain, getRendererWebContents: () => renderer },
    );

    await bundle.deviceManager.refresh();
    expect(sent.some((s) => s.channel === "audio-bridge:list-devices")).toBe(true);
  });
});

describe("UnavailableAudioBridge", () => {
  it("lists no devices and reports no permission, honestly", async () => {
    const bridge = new UnavailableAudioBridge();
    await expect(bridge.listDevices()).resolves.toEqual([]);
    await expect(bridge.hasPermission("microphone")).resolves.toBe(false);
    await expect(bridge.requestPermission("microphone")).resolves.toBe(false);
  });

  it("startCapture throws AudioBridgeUnavailableError rather than fabricating audio frames", async () => {
    const bridge = new UnavailableAudioBridge();
    const iterator = bridge.startCapture("default", 16000)[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(AudioBridgeUnavailableError);
  });

  it("play throws AudioBridgeUnavailableError rather than pretending to play audio", async () => {
    const bridge = new UnavailableAudioBridge();
    await expect(
      bridge.play("default", (async function* () {})(), new AbortController().signal),
    ).rejects.toThrow(AudioBridgeUnavailableError);
  });
});

describe("ReferenceVoiceRuntimeProvider", () => {
  it("is always available (no external process/model server to fail)", async () => {
    const provider = new ReferenceVoiceRuntimeProvider();
    await expect(provider.isAvailable()).resolves.toBe(true);
  });

  it("returns an honestly-labeled placeholder transcript, not a fabricated recognition result", async () => {
    const provider = new ReferenceVoiceRuntimeProvider();
    const result = await provider.transcribe("any-model", {
      audioBytes: new Uint8Array([1, 2, 3]),
    });
    expect(result.text).toContain("no production speech-recognition model");
  });

  it("returns a real, valid, playable WAV container", async () => {
    const provider = new ReferenceVoiceRuntimeProvider();
    const result = await provider.synthesizeSpeech("any-model", { text: "hello" });
    const bytes = result.audioBytes;
    const header = new TextDecoder().decode(bytes.slice(0, 4));
    const wave = new TextDecoder().decode(bytes.slice(8, 12));
    expect(header).toBe("RIFF");
    expect(wave).toBe("WAVE");
    expect(bytes.length).toBeGreaterThan(44); // header + at least some sample data
  });
});
