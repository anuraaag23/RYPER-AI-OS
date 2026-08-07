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

export type VoiceSessionState =
  "idle" | "listening" | "processing" | "speaking" | "cancelled" | "error";

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
