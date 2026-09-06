import { describe, expect, it, vi } from "vitest";
import type { AudioFrame, TtsAudioChunk } from "@ryper/voice-engine";
import {
  AudioBridgeUnavailableError,
  createRendererAudioBridge,
  type RendererIpcReceiver,
  type RendererIpcSender,
} from "../electron/audio-bridge.js";
import { AUDIO_IPC_CHANNELS } from "../electron/audio-ipc-contract.js";

/**
 * A deterministic fake of the main<->renderer IPC boundary — no real
 * `electron` module involved. `send()` on the fake "renderer" hands the
 * command straight to whatever handler the test registered (simulating
 * `src/audio/index.ts` on the other side); `emitFromRenderer()` lets a
 * test simulate the renderer replying/pushing an event.
 */
function createFakeIpc(): {
  ipcMain: RendererIpcReceiver;
  renderer: RendererIpcSender & { readonly sent: Array<{ channel: string; payload: unknown }> };
  emitFromRenderer: (channel: string, payload: unknown) => void;
  destroyRenderer: () => void;
} {
  const mainListeners = new Map<string, Array<(event: unknown, payload: unknown) => void>>();
  const sent: Array<{ channel: string; payload: unknown }> = [];
  let destroyed = false;

  const ipcMain: RendererIpcReceiver = {
    on: (channel, listener) => {
      const list = mainListeners.get(channel) ?? [];
      list.push(listener);
      mainListeners.set(channel, list);
    },
    removeListener: (channel, listener) => {
      const list = mainListeners.get(channel);
      if (!list) return;
      mainListeners.set(
        channel,
        list.filter((l) => l !== listener),
      );
    },
  };

  const renderer = {
    send: (channel: string, payload: unknown) => {
      sent.push({ channel, payload });
    },
    isDestroyed: () => destroyed,
    sent,
  };

  return {
    ipcMain,
    renderer,
    emitFromRenderer: (channel, payload) => {
      for (const listener of mainListeners.get(channel) ?? []) listener(undefined, payload);
    },
    destroyRenderer: () => {
      destroyed = true;
    },
  };
}

async function drain<T>(iterable: AsyncIterable<T>, limit: number): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

describe("RendererAudioBridge", () => {
  it("listDevices() sends a request and resolves with the renderer's real device list", async () => {
    const { ipcMain, renderer, emitFromRenderer } = createFakeIpc();
    const bridge = createRendererAudioBridge(ipcMain, () => renderer);

    const promise = bridge.listDevices();
    expect(renderer.sent).toHaveLength(1);
    expect(renderer.sent[0]?.channel).toBe(AUDIO_IPC_CHANNELS.toRenderer.listDevices);
    const requestId = (renderer.sent[0]?.payload as { requestId: string }).requestId;

    emitFromRenderer(AUDIO_IPC_CHANNELS.fromRenderer.listDevicesResult, {
      requestId,
      devices: [
        {
          id: "mic-1",
          name: "Built-in Microphone",
          kind: "microphone",
          transport: "builtin",
          isDefault: true,
          supportedSampleRatesHz: [16000],
        },
      ],
    });

    const devices = await promise;
    expect(devices).toHaveLength(1);
    expect(devices[0]?.name).toBe("Built-in Microphone");
  });

  it("listDevices() degrades to an empty list (not a throw) when no renderer window exists", async () => {
    const { ipcMain } = createFakeIpc();
    const bridge = createRendererAudioBridge(ipcMain, () => undefined);
    await expect(bridge.listDevices()).resolves.toEqual([]);
  });

  it("hasPermission()/requestPermission() degrade to false when no renderer window exists", async () => {
    const { ipcMain } = createFakeIpc();
    const bridge = createRendererAudioBridge(ipcMain, () => undefined);
    await expect(bridge.hasPermission("microphone")).resolves.toBe(false);
    await expect(bridge.requestPermission("microphone")).resolves.toBe(false);
  });

  it("requestPermission() relays the renderer's real granted/denied result", async () => {
    const { ipcMain, renderer, emitFromRenderer } = createFakeIpc();
    const bridge = createRendererAudioBridge(ipcMain, () => renderer);

    const promise = bridge.requestPermission("microphone");
    const requestId = (renderer.sent[0]?.payload as { requestId: string }).requestId;
    emitFromRenderer(AUDIO_IPC_CHANNELS.fromRenderer.requestPermissionResult, {
      requestId,
      granted: false,
    });
    await expect(promise).resolves.toBe(false);
  });

  it("a request that never gets a reply rejects after the configured timeout, not indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const { ipcMain, renderer } = createFakeIpc();
      const bridge = createRendererAudioBridge(ipcMain, () => renderer, { requestTimeoutMs: 50 });
      const promise = bridge.setVolume("speaker-1", 0.5);
      const assertion = expect(promise).rejects.toThrow(AudioBridgeUnavailableError);
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("startCapture() streams real frames as they arrive over IPC", async () => {
    const { ipcMain, renderer, emitFromRenderer } = createFakeIpc();
    const bridge = createRendererAudioBridge(ipcMain, () => renderer);

    const iterable = bridge.startCapture("mic-1", 16000);
    const framesPromise = drain(iterable, 2);

    const startCall = renderer.sent.find(
      (s) => s.channel === AUDIO_IPC_CHANNELS.toRenderer.startCapture,
    );
    expect(startCall).toBeDefined();
    const requestId = (startCall!.payload as { requestId: string }).requestId;

    emitFromRenderer(AUDIO_IPC_CHANNELS.fromRenderer.captureFrame, {
      requestId,
      samples: new Int16Array([1, 2, 3]),
      sampleRateHz: 16000,
    });
    emitFromRenderer(AUDIO_IPC_CHANNELS.fromRenderer.captureFrame, {
      requestId,
      samples: new Int16Array([4, 5, 6]),
      sampleRateHz: 16000,
    });

    const frames = await framesPromise;
    expect(frames).toHaveLength(2);
    expect(Array.from((frames[0] as AudioFrame).samples)).toEqual([1, 2, 3]);
  });

  it("startCapture()'s iterator.return() sends a real stop-capture command to the renderer", async () => {
    const { ipcMain, renderer } = createFakeIpc();
    const bridge = createRendererAudioBridge(ipcMain, () => renderer);

    const iterable = bridge.startCapture("mic-1", 16000);
    const iterator = iterable[Symbol.asyncIterator]();
    // Simulate what `for await...of` does on early exit (exactly what
    // MicrophoneManager.stopCapture()'s AbortController causes).
    await iterator.return?.();

    const stopCall = renderer.sent.find(
      (s) => s.channel === AUDIO_IPC_CHANNELS.toRenderer.stopCapture,
    );
    expect(stopCall).toBeDefined();
  });

  it("startCapture() fails the stream with AudioBridgeUnavailableError when no renderer window exists", async () => {
    const { ipcMain } = createFakeIpc();
    const bridge = createRendererAudioBridge(ipcMain, () => undefined);
    const iterator = bridge.startCapture("mic-1", 16000)[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(AudioBridgeUnavailableError);
  });

  it("a captureError event from the renderer fails the stream honestly (no fabricated frames)", async () => {
    const { ipcMain, renderer, emitFromRenderer } = createFakeIpc();
    const bridge = createRendererAudioBridge(ipcMain, () => renderer);

    const iterator = bridge.startCapture("mic-1", 16000)[Symbol.asyncIterator]();
    const nextPromise = iterator.next();
    const startCall = renderer.sent.find(
      (s) => s.channel === AUDIO_IPC_CHANNELS.toRenderer.startCapture,
    );
    const requestId = (startCall!.payload as { requestId: string }).requestId;

    emitFromRenderer(AUDIO_IPC_CHANNELS.fromRenderer.captureError, {
      requestId,
      message: "microphone permission was denied",
    });

    await expect(nextPromise).rejects.toThrow("microphone permission was denied");
  });

  it("play() streams every chunk to the renderer, then playEnd, then resolves on a real success reply", async () => {
    const { ipcMain, renderer, emitFromRenderer } = createFakeIpc();
    const bridge = createRendererAudioBridge(ipcMain, () => renderer);

    async function* chunks(): AsyncGenerator<TtsAudioChunk> {
      yield { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" };
      yield { bytes: new Uint8Array([4, 5, 6]), mimeType: "audio/wav" };
    }

    const controller = new AbortController();
    const playPromise = bridge.play("speaker-1", chunks(), controller.signal);

    // Let the async chunk iteration flush.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const playCall = renderer.sent.find((s) => s.channel === AUDIO_IPC_CHANNELS.toRenderer.play);
    const requestId = (playCall!.payload as { requestId: string }).requestId;
    const chunkCalls = renderer.sent.filter(
      (s) => s.channel === AUDIO_IPC_CHANNELS.toRenderer.playChunk,
    );
    expect(chunkCalls).toHaveLength(2);
    const endCall = renderer.sent.find((s) => s.channel === AUDIO_IPC_CHANNELS.toRenderer.playEnd);
    expect(endCall).toBeDefined();

    emitFromRenderer(AUDIO_IPC_CHANNELS.fromRenderer.playResult, { requestId, ok: true });
    await expect(playPromise).resolves.toBeUndefined();
  });

  it("play() rejects when the renderer honestly reports a playback failure", async () => {
    const { ipcMain, renderer, emitFromRenderer } = createFakeIpc();
    const bridge = createRendererAudioBridge(ipcMain, () => renderer);

    async function* chunks(): AsyncGenerator<TtsAudioChunk> {
      yield { bytes: new Uint8Array([1]), mimeType: "audio/wav" };
    }

    const controller = new AbortController();
    const playPromise = bridge.play("speaker-1", chunks(), controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const playCall = renderer.sent.find((s) => s.channel === AUDIO_IPC_CHANNELS.toRenderer.play);
    const requestId = (playCall!.payload as { requestId: string }).requestId;

    emitFromRenderer(AUDIO_IPC_CHANNELS.fromRenderer.playResult, {
      requestId,
      ok: false,
      error: "AudioContext decode failed",
    });
    await expect(playPromise).rejects.toThrow("AudioContext decode failed");
  });

  it("play() throws immediately when no renderer window exists — never silently pretends to play", async () => {
    const { ipcMain } = createFakeIpc();
    const bridge = createRendererAudioBridge(ipcMain, () => undefined);
    async function* chunks(): AsyncGenerator<TtsAudioChunk> {
      yield { bytes: new Uint8Array([1]), mimeType: "audio/wav" };
    }
    await expect(bridge.play("speaker-1", chunks(), new AbortController().signal)).rejects.toThrow(
      AudioBridgeUnavailableError,
    );
  });

  it("barge-in: aborting mid-stream sends stopPlayback and stops pulling further chunks, without hanging", async () => {
    const { ipcMain, renderer } = createFakeIpc();
    const bridge = createRendererAudioBridge(ipcMain, () => renderer);

    let yielded = 0;
    async function* chunks(): AsyncGenerator<TtsAudioChunk> {
      for (let i = 0; i < 5; i++) {
        yielded++;
        yield { bytes: new Uint8Array([i]), mimeType: "audio/wav" };
        // A macrotask yield between chunks (like a real streaming source
        // reading the next piece off the wire) so this interleaves with
        // the test driver's timing instead of draining entirely within
        // one microtask flush.
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    const controller = new AbortController();
    const playPromise = bridge.play("speaker-1", chunks(), controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the first chunk flow

    controller.abort();
    await playPromise; // must resolve promptly — not hang waiting for the stream to finish

    const stopCall = renderer.sent.find(
      (s) => s.channel === AUDIO_IPC_CHANNELS.toRenderer.stopPlayback,
    );
    expect(stopCall).toBeDefined();
    expect(yielded).toBeLessThan(5);
  });

  it("setVolume() relays a real ok result", async () => {
    const { ipcMain, renderer, emitFromRenderer } = createFakeIpc();
    const bridge = createRendererAudioBridge(ipcMain, () => renderer);

    const promise = bridge.setVolume("speaker-1", 0.5);
    const call = renderer.sent.find((s) => s.channel === AUDIO_IPC_CHANNELS.toRenderer.setVolume);
    const requestId = (call!.payload as { requestId: string }).requestId;
    emitFromRenderer(AUDIO_IPC_CHANNELS.fromRenderer.setVolumeResult, { requestId, ok: true });
    await expect(promise).resolves.toBeUndefined();
  });

  it("setVolume() throws AudioBridgeUnavailableError when no renderer window exists", async () => {
    const { ipcMain } = createFakeIpc();
    const bridge = createRendererAudioBridge(ipcMain, () => undefined);
    await expect(bridge.setVolume("speaker-1", 0.5)).rejects.toThrow(AudioBridgeUnavailableError);
  });

  it("a renderer devicechange event invokes the onDeviceChange callback (wired to AudioDeviceManager.refresh())", async () => {
    const { ipcMain, emitFromRenderer } = createFakeIpc();
    const onDeviceChange = vi.fn();
    createRendererAudioBridge(ipcMain, () => undefined, { onDeviceChange });
    emitFromRenderer(AUDIO_IPC_CHANNELS.fromRenderer.deviceChange, { reason: "devicechange" });
    expect(onDeviceChange).toHaveBeenCalledTimes(1);
  });

  it("treats a destroyed renderer WebContents the same as no renderer at all", async () => {
    const { ipcMain, renderer, destroyRenderer } = createFakeIpc();
    destroyRenderer();
    const bridge = createRendererAudioBridge(ipcMain, () => renderer);
    await expect(bridge.listDevices()).resolves.toEqual([]);
    expect(renderer.sent).toHaveLength(0);
  });
});
