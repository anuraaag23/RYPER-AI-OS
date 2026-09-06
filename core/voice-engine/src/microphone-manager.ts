import { createLogger } from "@ryper/logging";
import type { AudioDeviceManager } from "./audio-device-manager.js";
import type { AudioDevice, AudioFrame } from "./types.js";

const log = createLogger("voice-engine:microphone-manager");

/** The actual hardware capture loop — a platform shell's native mic bridge. */
export interface AudioCaptureSource {
  startCapture(deviceId: string, sampleRateHz: number): AsyncIterable<AudioFrame>;
}

/**
 * Never captures beyond an explicit `startCapture()`/`stopCapture()` pair
 * — there is no ambient "always listening" mode here (that's the Wake
 * Word Engine's job, and it uses its own bounded listening window). This
 * class only ever streams frames while a caller is actively iterating the
 * `AsyncIterable` it returns.
 */
export class MicrophoneManager {
  private activeController: AbortController | undefined;

  constructor(
    private readonly deviceManager: AudioDeviceManager,
    private readonly captureSource: AudioCaptureSource,
  ) {}

  getActiveDevice(): AudioDevice | undefined {
    return this.deviceManager.getDefault("microphone");
  }

  selectDevice(deviceId: string): void {
    this.deviceManager.setDefault("microphone", deviceId);
  }

  isCapturing(): boolean {
    return this.activeController !== undefined;
  }

  async *startCapture(sampleRateHz = 16000): AsyncGenerator<AudioFrame> {
    if (this.activeController) {
      throw new Error("microphone capture is already active — call stopCapture() first");
    }
    const device = this.getActiveDevice();
    if (!device) throw new Error("no microphone device is available");
    if (!device.supportedSampleRatesHz.includes(sampleRateHz)) {
      throw new Error(`device "${device.id}" does not support ${sampleRateHz}Hz`);
    }

    const controller = new AbortController();
    this.activeController = controller;
    log.info("microphone capture started", { deviceId: device.id, sampleRateHz });

    try {
      for await (const frame of this.captureSource.startCapture(device.id, sampleRateHz)) {
        if (controller.signal.aborted) return;
        yield frame;
      }
    } finally {
      this.activeController = undefined;
      log.info("microphone capture stopped", { deviceId: device.id });
    }
  }

  stopCapture(): void {
    this.activeController?.abort();
    this.activeController = undefined;
  }
}

export function createMicrophoneManager(
  deviceManager: AudioDeviceManager,
  captureSource: AudioCaptureSource,
): MicrophoneManager {
  return new MicrophoneManager(deviceManager, captureSource);
}
