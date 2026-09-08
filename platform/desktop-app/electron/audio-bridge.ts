import { randomUUID } from "node:crypto";
import { createLogger } from "@ryper/logging";
import type { AudioDeviceSource } from "@ryper/voice-engine";
import type { AudioCaptureSource } from "@ryper/voice-engine";
import type { AudioPlaybackSink } from "@ryper/voice-engine";
import type { AudioDevice, AudioDeviceKind, AudioFrame, TtsAudioChunk } from "@ryper/voice-engine";
import {
  AUDIO_IPC_CHANNELS,
  type CaptureErrorEvent,
  type CaptureFrameEvent,
  type CaptureStoppedEvent,
  type ListDevicesResult,
  type PermissionResult,
  type PlayResult,
  type SetVolumeResult,
} from "./audio-ipc-contract.js";

const log = createLogger("desktop-app:audio-bridge");

export class AudioBridgeUnavailableError extends Error {}

/**
 * The desktop app's honest default for every real-hardware audio seam
 * `@ryper/voice-engine` defines (`AudioDeviceSource`, `AudioCaptureSource`,
 * `AudioPlaybackSink`) when no renderer window exists to bridge through —
 * mirrors `@ryper/windows-agent`'s `unavailableShellExec` pattern exactly:
 * it does not pretend to capture or play real audio, it explains plainly
 * why not. `RendererAudioBridge` below is the real Phase 13.6
 * implementation and is what `voice-bootstrap.ts` wires up whenever a
 * renderer `WebContents` is available (i.e. every real desktop-app run);
 * this class remains the fallback for the no-window case (headless
 * bootstrap, and every existing unit test that constructs the voice
 * pipeline without a `BrowserWindow`) and for tests that want a
 * deterministic "hardware absent" double.
 */
export class UnavailableAudioBridge
  implements AudioDeviceSource, AudioCaptureSource, AudioPlaybackSink
{
  async listDevices(): Promise<readonly AudioDevice[]> {
    return [];
  }

  async hasPermission(_kind: AudioDeviceKind): Promise<boolean> {
    return false;
  }

  async requestPermission(_kind: AudioDeviceKind): Promise<boolean> {
    log.warn("microphone/speaker permission requested, but no real audio bridge is wired up yet");
    return false;
  }

  startCapture(_deviceId: string, _sampleRateHz: number): AsyncIterable<AudioFrame> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<AudioFrame>> =>
          Promise.reject(
            new AudioBridgeUnavailableError(
              "no real microphone capture bridge is available — no renderer window to bridge through",
            ),
          ),
      }),
    };
  }

  async play(
    _deviceId: string,
    _chunks: AsyncIterable<TtsAudioChunk>,
    _signal: AbortSignal,
  ): Promise<void> {
    throw new AudioBridgeUnavailableError(
      "no real speaker playback bridge is available — no renderer window to bridge through",
    );
  }

  async setVolume(_deviceId: string, _volume: number): Promise<void> {
    throw new AudioBridgeUnavailableError(
      "no real speaker playback bridge is available — no renderer window to bridge through",
    );
  }
}

export function createUnavailableAudioBridge(): UnavailableAudioBridge {
  return new UnavailableAudioBridge();
}

// ---------------------------------------------------------------------
// RendererAudioBridge — Phase 13.6's real implementation.
// ---------------------------------------------------------------------

/**
 * The slice of `Electron.WebContents` this file actually needs. Defined
 * locally (rather than `import type { WebContents } from "electron"`) so
 * this file — and its unit tests — never import the real `electron`
 * module, which only resolves to a usable API inside a running Electron
 * process. Matches `AudioDeviceManager`'s own `HttpFetch`/`FileSystemLike`-
 * style dependency injection: the real object (`BrowserWindow#webContents`)
 * satisfies this structurally, no adapter needed.
 */
export interface RendererIpcSender {
  send(channel: string, payload: unknown): void;
  isDestroyed?(): boolean;
}

/** The slice of `Electron.IpcMain` this file needs — same rationale as `RendererIpcSender`. */
/**
 * Generic per-call so each `this.ipc.on(channel, listener)` below can
 * declare its own specific reply/event shape (`ListDevicesResult`,
 * `CaptureFrameEvent`, ...) and have it checked, rather than every
 * listener being forced to accept `unknown` and cast internally.
 */
export interface RendererIpcReceiver {
  on<T = unknown>(channel: string, listener: (event: unknown, payload: T) => void): void;
  removeListener<T = unknown>(
    channel: string,
    listener: (event: unknown, payload: T) => void,
  ): void;
}

export interface RendererAudioBridgeOptions {
  /** How long to wait for a renderer reply before treating it as unavailable. Default 8000ms. */
  readonly requestTimeoutMs?: number;
  /** How long to wait for audio playback completion before timing out. Default 60000ms. */
  readonly playbackTimeoutMs?: number;
  /**
   * Called whenever the renderer reports `navigator.mediaDevices.ondevicechange`
   * (a device was plugged in, unplugged, or the OS default changed). The
   * caller (`voice-bootstrap.ts`) wires this to `AudioDeviceManager.refresh()`.
   */
  readonly onDeviceChange?: () => void;
}

interface QueuePendingRequest<T> {
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

/**
 * `RendererAudioBridge`'s single pending-request map holds requests of
 * many different reply shapes (`ListDevicesResult`, `PermissionResult`,
 * `PlayResult`, ...) at once, keyed only by `requestId` — so its
 * resolvers are deliberately untyped here and cast to the specific
 * expected shape at each call site in `request<T>()`/`play()`, which is
 * where the actual type safety lives (the cast is narrow and co-located
 * with the code that knows which request produced which reply).
 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

/**
 * Bridges an `AsyncIterable<AudioFrame>` (pulled by `MicrophoneManager`)
 * to frames pushed in asynchronously from IPC events. Critically
 * implements `AsyncIterator.return()`: when a `for await...of` consumer
 * exits early (exactly what `MicrophoneManager.stopCapture()`'s
 * `AbortController` causes in `audio-pipeline-manager.ts`/`voice-
 * pipeline.ts`'s `endpointedFrames()`), the language runtime calls
 * `return()` automatically — which is how cancellation here actually
 * reaches the renderer and stops the real `MediaStreamTrack`, not merely
 * an internal enum.
 */
class CaptureQueue implements AsyncIterable<AudioFrame> {
  private readonly buffer: AudioFrame[] = [];
  private pending: QueuePendingRequest<IteratorResult<AudioFrame>> | undefined;
  private closed = false;
  private failure: unknown;

  constructor(private readonly onEarlyReturn: () => void) {}

  push(frame: AudioFrame): void {
    if (this.closed) return;
    if (this.pending) {
      const p = this.pending;
      this.pending = undefined;
      p.resolve({ value: frame, done: false });
    } else {
      this.buffer.push(frame);
    }
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending?.resolve({ value: undefined as unknown as AudioFrame, done: true });
    this.pending = undefined;
  }

  fail(err: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = err;
    this.pending?.reject(err);
    this.pending = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<AudioFrame> {
    return {
      next: (): Promise<IteratorResult<AudioFrame>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift() as AudioFrame, done: false });
        }
        if (this.closed) {
          if (this.failure) return Promise.reject(this.failure);
          return Promise.resolve({ value: undefined as unknown as AudioFrame, done: true });
        }
        return new Promise<IteratorResult<AudioFrame>>((resolve, reject) => {
          this.pending = { resolve, reject };
        });
      },
      return: (value?: unknown): Promise<IteratorResult<AudioFrame>> => {
        if (!this.closed) {
          this.closed = true;
          this.buffer.length = 0;
          this.onEarlyReturn();
        }
        return Promise.resolve({ value: value as AudioFrame, done: true });
      },
    };
  }
}

/**
 * The real Phase 13.6 audio bridge. Owns none of the actual hardware
 * access itself — that only exists in a Chromium renderer process
 * (`src/audio/*`, via `navigator.mediaDevices.getUserMedia()` and
 * `AudioContext`) — this class is the main-process half of that bridge,
 * translating `AudioDeviceSource`/`AudioCaptureSource`/`AudioPlaybackSink`
 * calls into typed IPC commands (see `audio-ipc-contract.ts`) and typed
 * replies back into the shapes `@ryper/voice-engine` expects. Every
 * device/permission/capture/playback operation here corresponds to a
 * real browser API call in the renderer — nothing here fabricates a
 * device, a frame, or a completion.
 */
export class RendererAudioBridge
  implements AudioDeviceSource, AudioCaptureSource, AudioPlaybackSink
{
  private readonly timeoutMs: number;
  private readonly playbackTimeoutMs: number;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly activeCaptures = new Map<string, CaptureQueue>();
  /**
   * Set from the most recent `PlayResult.sinkRoutingFailed`, cleared on
   * the next playback that either succeeds at routing or requests no
   * specific device — so this always reflects the *current* selected
   * device's real routing state, not a stale one-time failure (see
   * `getLastSinkRoutingWarning()`).
   */
  private lastSinkRoutingWarning: string | undefined;

  constructor(
    private readonly ipc: RendererIpcReceiver,
    private readonly getRenderer: () => RendererIpcSender | undefined,
    options: RendererAudioBridgeOptions = {},
  ) {
    this.timeoutMs = options.requestTimeoutMs ?? 8000;
    this.playbackTimeoutMs = options.playbackTimeoutMs ?? 60_000;

    this.ipc.on(AUDIO_IPC_CHANNELS.fromRenderer.listDevicesResult, (_e, r: ListDevicesResult) =>
      this.resolvePending(r.requestId, r),
    );
    this.ipc.on(AUDIO_IPC_CHANNELS.fromRenderer.hasPermissionResult, (_e, r: PermissionResult) =>
      this.resolvePending(r.requestId, r),
    );
    this.ipc.on(
      AUDIO_IPC_CHANNELS.fromRenderer.requestPermissionResult,
      (_e, r: PermissionResult) => this.resolvePending(r.requestId, r),
    );
    this.ipc.on(AUDIO_IPC_CHANNELS.fromRenderer.playResult, (_e, r: PlayResult) =>
      this.resolvePending(r.requestId, r),
    );
    this.ipc.on(AUDIO_IPC_CHANNELS.fromRenderer.setVolumeResult, (_e, r: SetVolumeResult) =>
      this.resolvePending(r.requestId, r),
    );
    this.ipc.on(AUDIO_IPC_CHANNELS.fromRenderer.captureFrame, (_e, ev: CaptureFrameEvent) => {
      this.activeCaptures
        .get(ev.requestId)
        ?.push({ samples: ev.samples, sampleRateHz: ev.sampleRateHz });
    });
    this.ipc.on(AUDIO_IPC_CHANNELS.fromRenderer.captureError, (_e, ev: CaptureErrorEvent) => {
      this.activeCaptures.get(ev.requestId)?.fail(new AudioBridgeUnavailableError(ev.message));
      this.activeCaptures.delete(ev.requestId);
    });
    this.ipc.on(AUDIO_IPC_CHANNELS.fromRenderer.captureStopped, (_e, ev: CaptureStoppedEvent) => {
      this.activeCaptures.get(ev.requestId)?.end();
      this.activeCaptures.delete(ev.requestId);
    });
    this.ipc.on(AUDIO_IPC_CHANNELS.fromRenderer.deviceChange, () => {
      options.onDeviceChange?.();
    });
  }

  private resolvePending(requestId: string, value: unknown): void {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    p.resolve(value);
  }

  private request<T>(
    channel: string,
    payload: { requestId: string } & Record<string, unknown>,
  ): Promise<T> {
    const renderer = this.getRenderer();
    if (!renderer || renderer.isDestroyed?.()) {
      return Promise.reject(
        new AudioBridgeUnavailableError(
          "no renderer window is available to bridge real audio through",
        ),
      );
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(payload.requestId);
        reject(
          new AudioBridgeUnavailableError(
            `renderer audio bridge did not respond to "${channel}" within ${this.timeoutMs}ms`,
          ),
        );
      }, this.timeoutMs);
      this.pending.set(payload.requestId, {
        resolve: (v: unknown) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e: unknown) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      renderer.send(channel, payload);
    });
  }

  async listDevices(): Promise<readonly AudioDevice[]> {
    try {
      const requestId = randomUUID();
      const result = await this.request<ListDevicesResult>(
        AUDIO_IPC_CHANNELS.toRenderer.listDevices,
        { requestId },
      );
      if (result.error) {
        log.warn("renderer reported an error listing audio devices", { error: result.error });
        return [];
      }
      return (result.devices ?? []).map((d) => ({ ...d }));
    } catch (err) {
      log.warn("could not list audio devices", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async hasPermission(kind: AudioDeviceKind): Promise<boolean> {
    try {
      const requestId = randomUUID();
      const result = await this.request<PermissionResult>(
        AUDIO_IPC_CHANNELS.toRenderer.hasPermission,
        { requestId, kind },
      );
      if (result.error) return false;
      return result.granted ?? false;
    } catch {
      return false;
    }
  }

  async requestPermission(kind: AudioDeviceKind): Promise<boolean> {
    try {
      const requestId = randomUUID();
      const result = await this.request<PermissionResult>(
        AUDIO_IPC_CHANNELS.toRenderer.requestPermission,
        { requestId, kind },
      );
      if (result.error) {
        log.warn("renderer reported an error requesting audio permission", {
          kind,
          error: result.error,
        });
        return false;
      }
      return result.granted ?? false;
    } catch (err) {
      log.warn("could not request audio permission — no renderer bridge available", {
        kind,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  startCapture(deviceId: string, sampleRateHz: number): AsyncIterable<AudioFrame> {
    const requestId = randomUUID();
    let started = false;
    const queue = new CaptureQueue(() => {
      this.activeCaptures.delete(requestId);
      const renderer = this.getRenderer();
      if (renderer && !renderer.isDestroyed?.()) {
        renderer.send(AUDIO_IPC_CHANNELS.toRenderer.stopCapture, { requestId });
      }
    });

    return {
      [Symbol.asyncIterator]: (): AsyncIterator<AudioFrame> => {
        if (!started) {
          started = true;
          const renderer = this.getRenderer();
          if (!renderer || renderer.isDestroyed?.()) {
            queue.fail(
              new AudioBridgeUnavailableError(
                "no renderer window is available to bridge real microphone capture through",
              ),
            );
          } else {
            this.activeCaptures.set(requestId, queue);
            renderer.send(AUDIO_IPC_CHANNELS.toRenderer.startCapture, {
              requestId,
              deviceId,
              sampleRateHz,
            });
          }
        }
        return queue[Symbol.asyncIterator]();
      },
    };
  }

  async play(
    deviceId: string,
    chunks: AsyncIterable<TtsAudioChunk>,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return;
    const renderer = this.getRenderer();
    if (!renderer || renderer.isDestroyed?.()) {
      throw new AudioBridgeUnavailableError(
        "no renderer window is available to bridge real speaker playback through",
      );
    }

    const requestId = randomUUID();
    const resultPromise = new Promise<PlayResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          requestId,
          ok: false,
          error: `renderer audio bridge did not confirm playback completion within ${this.playbackTimeoutMs}ms`,
        });
      }, this.playbackTimeoutMs);
      this.pending.set(requestId, {
        resolve: (v: unknown) => {
          clearTimeout(timer);
          resolve(v as PlayResult);
        },
        reject: () => {
          clearTimeout(timer);
          resolve({ requestId, ok: false });
        },
      });
    });

    // Cancellation must reach the real audio device, not merely an internal
    // enum: this sends `stopPlayback` straight to the renderer, which stops
    // the actual `AudioBufferSourceNode`(s) — see src/audio/playback-client.ts.
    const onAbort = (): void => {
      this.getRenderer()?.send(AUDIO_IPC_CHANNELS.toRenderer.stopPlayback, { requestId });
    };
    signal.addEventListener("abort", onAbort);

    renderer.send(AUDIO_IPC_CHANNELS.toRenderer.play, { requestId, deviceId });

    try {
      const iterator = chunks[Symbol.asyncIterator]();
      let abortedDuringIteration = false;
      // Races each `next()` against the abort signal directly, rather than
      // only checking `signal.aborted` between iterations: a chunk source
      // can be suspended mid-`next()` for an arbitrary time (e.g. waiting
      // on a network read), and barge-in must not wait for that to settle
      // on its own — `play()` has to return promptly once the real
      // `stopPlayback` message has been sent, matching the "cancellation
      // must reach the actual audio device" requirement.
      const abortSignalPromise = new Promise<"aborted">((resolve) => {
        if (signal.aborted) resolve("aborted");
        else signal.addEventListener("abort", () => resolve("aborted"), { once: true });
      });
      try {
        while (true) {
          const step = await Promise.race([
            iterator.next().then((r) => ({ kind: "value" as const, r })),
            abortSignalPromise.then((k) => ({ kind: k })),
          ]);
          if (step.kind === "aborted") {
            abortedDuringIteration = true;
            break;
          }
          const { value, done } = step.r;
          if (done) break;
          this.getRenderer()?.send(AUDIO_IPC_CHANNELS.toRenderer.playChunk, {
            requestId,
            bytes: value.bytes,
            mimeType: value.mimeType,
          });
        }
      } finally {
        if (abortedDuringIteration) {
          // Best-effort cleanup of the chunk source — deliberately not
          // awaited: a generator can be stuck on an internal await that
          // will never observe this `.return()` call (a real JS
          // limitation, not something this bridge can work around), and
          // `play()` must not hang waiting for it.
          void iterator.return?.();
        }
        if (!abortedDuringIteration) {
          this.getRenderer()?.send(AUDIO_IPC_CHANNELS.toRenderer.playEnd, { requestId });
        }
      }

      if (abortedDuringIteration || signal.aborted) return; // barge-in: return immediately, don't await a completion ack

      const result = await resultPromise;
      this.lastSinkRoutingWarning = result.sinkRoutingFailed;
      if (!result.ok) {
        throw new AudioBridgeUnavailableError(
          result.error ?? "renderer audio bridge reported a playback failure",
        );
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.pending.delete(requestId);
    }
  }

  /**
   * The most recent real reason output-device routing fell back to the
   * default device instead of the one selected in Settings, or
   * `undefined` if the last completed playback either routed
   * successfully or didn't request a specific device. Read by
   * `computeAudioStatus()` in `ipc-handlers.ts` so the Settings UI can
   * show this honestly instead of implying the selection took effect.
   */
  getLastSinkRoutingWarning(): string | undefined {
    return this.lastSinkRoutingWarning;
  }

  /**
   * Called when the user picks a different speaker (see
   * `ipc-handlers.ts`'s `selectAudioDevice` handler) — a routing
   * failure recorded against the *previous* device shouldn't keep
   * showing once a different one has been selected but not yet tried.
   */
  clearLastSinkRoutingWarning(): void {
    this.lastSinkRoutingWarning = undefined;
  }

  async setVolume(deviceId: string, volume: number): Promise<void> {
    const requestId = randomUUID();
    const result = await this.request<SetVolumeResult>(AUDIO_IPC_CHANNELS.toRenderer.setVolume, {
      requestId,
      deviceId,
      volume,
    });
    if (!result.ok) {
      throw new AudioBridgeUnavailableError(
        result.error ?? "renderer audio bridge reported a setVolume failure",
      );
    }
  }
}

export function createRendererAudioBridge(
  ipc: RendererIpcReceiver,
  getRenderer: () => RendererIpcSender | undefined,
  options?: RendererAudioBridgeOptions,
): RendererAudioBridge {
  return new RendererAudioBridge(ipc, getRenderer, options);
}
