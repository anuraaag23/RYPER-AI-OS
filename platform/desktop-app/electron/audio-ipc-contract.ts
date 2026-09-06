/**
 * Phase 13.6 — the wire format between the Electron main process (where
 * `RendererAudioBridge` in `audio-bridge.ts` implements `@ryper/voice-
 * engine`'s `AudioDeviceSource`/`AudioCaptureSource`/`AudioPlaybackSink`)
 * and the renderer process (where `src/audio/*` actually calls
 * `navigator.mediaDevices`/`AudioContext` — the only place in an Electron
 * app real microphone/speaker access lives, short of a native Node
 * addon). Both sides import this file so a channel added here is
 * type-checked on both sides, matching `ipc-contract.ts`'s existing
 * pattern for the renderer's user-facing API.
 *
 * Every "toRenderer" channel is a command the main process's audio
 * bridge sends; every "fromRenderer" channel is a reply/event the
 * renderer's audio client sends back. Requests carry a `requestId` so
 * concurrent operations (e.g. a capture in progress while a device list
 * refresh is requested) never cross wires.
 */

export const AUDIO_IPC_CHANNELS = {
  toRenderer: {
    listDevices: "audio-bridge:list-devices",
    hasPermission: "audio-bridge:has-permission",
    requestPermission: "audio-bridge:request-permission",
    startCapture: "audio-bridge:start-capture",
    stopCapture: "audio-bridge:stop-capture",
    play: "audio-bridge:play",
    playChunk: "audio-bridge:play-chunk",
    playEnd: "audio-bridge:play-end",
    stopPlayback: "audio-bridge:stop-playback",
    setVolume: "audio-bridge:set-volume",
  },
  fromRenderer: {
    listDevicesResult: "audio-bridge:list-devices-result",
    hasPermissionResult: "audio-bridge:has-permission-result",
    requestPermissionResult: "audio-bridge:request-permission-result",
    captureFrame: "audio-bridge:capture-frame",
    captureError: "audio-bridge:capture-error",
    captureStopped: "audio-bridge:capture-stopped",
    playResult: "audio-bridge:play-result",
    setVolumeResult: "audio-bridge:set-volume-result",
    deviceChange: "audio-bridge:device-change",
  },
} as const;

export type AudioDeviceKindWire = "microphone" | "speaker";
export type AudioDeviceTransportWire = "builtin" | "usb" | "bluetooth" | "virtual";

export interface AudioDeviceWire {
  readonly id: string;
  readonly name: string;
  readonly kind: AudioDeviceKindWire;
  readonly transport: AudioDeviceTransportWire;
  readonly isDefault: boolean;
  readonly supportedSampleRatesHz: readonly number[];
}

// ---- main -> renderer commands ----

export interface ListDevicesCommand {
  readonly requestId: string;
}
export interface HasPermissionCommand {
  readonly requestId: string;
  readonly kind: AudioDeviceKindWire;
}
export interface RequestPermissionCommand {
  readonly requestId: string;
  readonly kind: AudioDeviceKindWire;
}
export interface StartCaptureCommand {
  readonly requestId: string;
  readonly deviceId: string;
  readonly sampleRateHz: number;
}
export interface StopCaptureCommand {
  readonly requestId: string;
}
export interface PlayCommand {
  readonly requestId: string;
  readonly deviceId: string;
}
export interface PlayChunkCommand {
  readonly requestId: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}
export interface PlayEndCommand {
  readonly requestId: string;
}
export interface StopPlaybackCommand {
  readonly requestId: string;
}
export interface SetVolumeCommand {
  readonly requestId: string;
  readonly deviceId: string;
  readonly volume: number;
}

// ---- renderer -> main replies/events ----

export interface ListDevicesResult {
  readonly requestId: string;
  readonly devices?: readonly AudioDeviceWire[];
  readonly error?: string;
}
export interface PermissionResult {
  readonly requestId: string;
  readonly granted?: boolean;
  readonly error?: string;
}
export interface CaptureFrameEvent {
  readonly requestId: string;
  readonly samples: Int16Array;
  readonly sampleRateHz: number;
}
export interface CaptureErrorEvent {
  readonly requestId: string;
  readonly message: string;
}
export interface CaptureStoppedEvent {
  readonly requestId: string;
}
export interface PlayResult {
  readonly requestId: string;
  readonly ok: boolean;
  readonly error?: string;
  /**
   * Set when the requested output device could not actually be routed
   * to (e.g. `HTMLMediaElement.setSinkId()` unsupported or rejected) —
   * playback still completed, but through the system default output,
   * not the one the user selected in Settings. Absent when routing
   * wasn't attempted (no explicit device requested) or succeeded.
   */
  readonly sinkRoutingFailed?: string;
}
export interface SetVolumeResult {
  readonly requestId: string;
  readonly ok: boolean;
  readonly error?: string;
}
export interface DeviceChangeEvent {
  readonly reason: "devicechange";
}
