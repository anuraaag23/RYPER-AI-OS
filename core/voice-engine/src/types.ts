// ---- Audio primitives ----

/** Raw PCM audio: 16-bit signed little-endian samples, mono unless noted. */
export interface AudioFrame {
  readonly samples: Int16Array;
  readonly sampleRateHz: number;
}

export type AudioDeviceKind = "microphone" | "speaker";
export type AudioDeviceTransport = "builtin" | "usb" | "bluetooth" | "virtual";

export interface AudioDevice {
  readonly id: string;
  readonly name: string;
  readonly kind: AudioDeviceKind;
  readonly transport: AudioDeviceTransport;
  readonly isDefault: boolean;
  readonly supportedSampleRatesHz: readonly number[];
}

// ---- Wake word ----

export interface WakeWordDetection {
  readonly wakeWord: string;
  readonly confidence: number; // 0..1
  readonly detectedAt: string;
}

// ---- Voice activity detection ----

export interface VadResult {
  readonly isSpeech: boolean;
  readonly energy: number;
}

// ---- Speech recognition (STT) ----

export type SttEvent =
  | { readonly type: "partial"; readonly text: string; readonly confidence: number }
  | {
      readonly type: "final";
      readonly text: string;
      readonly confidence: number;
      readonly language?: string;
    }
  | { readonly type: "error"; readonly message: string };

export interface SttRequestOptions {
  readonly languageHint?: string;
  readonly signal?: AbortSignal;
}

// ---- Text to speech (TTS) ----

export interface VoiceProfile {
  readonly id: string;
  readonly name: string;
  readonly language: string;
}

export interface TtsRequestOptions {
  readonly voiceId?: string;
  readonly speed?: number; // 1.0 = normal
  readonly pitch?: number; // 1.0 = normal
  readonly emotion?: string; // provider-specific preset name, if supported
  readonly signal?: AbortSignal;
}

export interface TtsAudioChunk {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

// ---- Voice session ----

/**
 * The 10-state model (Tier 1 completion pass — see `docs/adr/0028`),
 * replacing the earlier 6-state
 * `idle|listening|processing|speaking|cancelled|error` model:
 *
 * - `idle` — at rest, nothing in flight.
 * - `listening` — the microphone is open and VAD-endpointed capture is
 *   in progress.
 * - `transcribing` — capture has ended (endpoint reached / mic closed)
 *   and the pipeline is waiting on the STT provider's final result.
 *   Previously indistinguishable from `listening`, which left a UI's
 *   "mic is live" indicator lit after the user had already stopped
 *   talking.
 * - `thinking` — intent detection and/or the AI Engine call is in
 *   progress. Renamed from `processing` for clarity against the new,
 *   more specific states below.
 * - `tool_execution` — a sub-state of `thinking`, entered specifically
 *   while `AIOrchestrator.sendMessage()` is invoking a tool call
 *   (`StreamEvent.type === "tool_call"`) and left once the
 *   corresponding `tool_result` arrives.
 * - `speaking` — TTS synthesis/playback is in progress.
 * - `interrupted` — the user barged in (real, automatic speech
 *   detection) while RYPER was speaking. Distinct from `cancelled`,
 *   which is reserved for an explicit, external stop request (e.g. a
 *   "stop" button/IPC call) — barge-in is a normal, expected
 *   conversational event, not an error or a user-initiated abort.
 * - `recovering` — a transient failure occurred and an automatic retry
 *   (`retryWithBackoff`'s `onRetry` hook) is about to be attempted,
 *   rather than failing the turn outright.
 * - `cancelled` — the turn was explicitly stopped from outside the
 *   pipeline.
 * - `error` — the turn failed and was not (or could not be) recovered.
 */
export type VoiceSessionState =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "tool_execution"
  | "speaking"
  | "interrupted"
  | "recovering"
  | "cancelled"
  | "error";

export interface VoiceSessionSnapshot {
  readonly sessionId: string;
  readonly state: VoiceSessionState;
  readonly startedAt: string;
  readonly lastActivityAt: string;
}

// ---- Voice commands ----

export interface VoiceCommandMatch {
  readonly intent: string;
  readonly slots: Readonly<Record<string, string>>;
  readonly confidence: number;
}

export interface VoiceCommandResult {
  readonly handled: boolean;
  readonly spokenResponse?: string;
}

// ---- Settings ----

export type OfflineCloudPreference =
  "offline_only" | "prefer_offline" | "prefer_cloud" | "cloud_only";
export type AudioQuality = "low" | "standard" | "high";

export interface VoiceSettings {
  readonly wakeWordSensitivity: number; // 0..1
  readonly voiceId: string;
  readonly microphoneDeviceId?: string;
  readonly speakerDeviceId?: string;
  readonly language: string;
  readonly offlineCloudPreference: OfflineCloudPreference;
  readonly audioQuality: AudioQuality;
  readonly wakeWordEnabled: boolean;
}

export const defaultVoiceSettings: VoiceSettings = {
  wakeWordSensitivity: 0.5,
  voiceId: "default",
  language: "en-US",
  offlineCloudPreference: "prefer_offline",
  audioQuality: "standard",
  wakeWordEnabled: true,
};
