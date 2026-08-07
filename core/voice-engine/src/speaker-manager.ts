import { createLogger } from "@ryper/logging";
import type { AudioDeviceManager } from "./audio-device-manager.js";
import type { AudioDevice, TtsAudioChunk } from "./types.js";

const log = createLogger("voice-engine:speaker-manager");

/** The actual hardware playback loop — a platform shell's native speaker bridge. */
export interface AudioPlaybackSink {
  play(deviceId: string, chunks: AsyncIterable<TtsAudioChunk>, signal: AbortSignal): Promise<void>;
  setVolume(deviceId: string, volume: number): Promise<void>;
}

/**
 * Plays one utterance at a time. Starting a new utterance while one is
 * playing cancels the previous one first — this is what makes TTS
 * "interruptible" (the brief's requirement) rather than queuing speech
 * indefinitely.
 */
export class SpeakerManager {
  private activeController: AbortController | undefined;
  private volume = 1.0;

  constructor(
    private readonly deviceManager: AudioDeviceManager,
    private readonly playbackSink: AudioPlaybackSink,
  ) {}

  getActiveDevice(): AudioDevice | undefined {
    return this.deviceManager.getDefault("speaker");
  }

  selectDevice(deviceId: string): void {
    this.deviceManager.setDefault("speaker", deviceId);
  }

  isSpeaking(): boolean {
    return this.activeController !== undefined;
  }

  async play(chunks: AsyncIterable<TtsAudioChunk>): Promise<void> {
    this.interrupt();
    const device = this.getActiveDevice();
    if (!device) throw new Error("no speaker device is available");

    const controller = new AbortController();
    this.activeController = controller;
    log.info("playback started", { deviceId: device.id });

    try {
      await this.playbackSink.play(device.id, chunks, controller.signal);
    } finally {
      if (this.activeController === controller) this.activeController = undefined;
      log.info("playback finished", {
        deviceId: device.id,
        interrupted: controller.signal.aborted,
      });
    }
  }

  /** Immediately stops whatever is currently playing — the "barge-in" / interruption path. */
  interrupt(): void {
    this.activeController?.abort();
    this.activeController = undefined;
  }

  async setVolume(volume: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, volume));
    const device = this.getActiveDevice();
    if (device) await this.playbackSink.setVolume(device.id, clamped);
    this.volume = clamped;
  }

  getVolume(): number {
    return this.volume;
  }
}

export function createSpeakerManager(
  deviceManager: AudioDeviceManager,
  playbackSink: AudioPlaybackSink,
): SpeakerManager {
  return new SpeakerManager(deviceManager, playbackSink);
}
