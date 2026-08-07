import { createLogger } from "@ryper/logging";
import type { EventBus } from "@ryper/event-bus";
import type { AudioDevice, AudioDeviceKind } from "./types.js";

const log = createLogger("voice-engine:device-manager");

/**
 * Enumerates devices and reports permission state. Real implementations
 * bridge to each platform's audio APIs (WASAPI/CoreAudio/PulseAudio/
 * ALSA/AVAudioSession/AudioManager); this package never touches hardware
 * directly, matching the injection pattern used throughout the codebase
 * (`HttpFetch`, `FileSystemLike`, `OnnxSession`, ...).
 */
export interface AudioDeviceSource {
  listDevices(): Promise<readonly AudioDevice[]>;
  hasPermission(kind: AudioDeviceKind): Promise<boolean>;
  requestPermission(kind: AudioDeviceKind): Promise<boolean>;
}

export type DeviceChangeEvent =
  | { readonly type: "connected"; readonly device: AudioDevice }
  | { readonly type: "disconnected"; readonly deviceId: string };

/**
 * Owns the current device list and default selection. Hot-swap detection
 * is driven by the caller invoking `refresh()` (a platform shell wires
 * this to its native device-change notification) — this class diffs the
 * before/after lists and emits `connected`/`disconnected` events rather
 * than polling.
 */
export class AudioDeviceManager {
  private devices: AudioDevice[] = [];
  private explicitDefaults = new Map<AudioDeviceKind, string>();

  constructor(
    private readonly source: AudioDeviceSource,
    private readonly eventBus?: EventBus,
  ) {}

  async refresh(): Promise<readonly AudioDevice[]> {
    const previous = new Map(this.devices.map((d) => [d.id, d]));
    const next = await this.source.listDevices();
    const nextIds = new Set(next.map((d) => d.id));

    for (const device of next) {
      if (!previous.has(device.id)) {
        void this.eventBus?.emit("voice_engine.device_connected", { device }, "voice-engine");
        log.info("device connected", { id: device.id, name: device.name });
      }
    }
    for (const device of previous.values()) {
      if (!nextIds.has(device.id)) {
        void this.eventBus?.emit(
          "voice_engine.device_disconnected",
          { deviceId: device.id },
          "voice-engine",
        );
        log.info("device disconnected", { id: device.id });
      }
    }

    this.devices = [...next];
    return this.devices;
  }

  list(kind?: AudioDeviceKind): readonly AudioDevice[] {
    return kind ? this.devices.filter((d) => d.kind === kind) : this.devices;
  }

  getDefault(kind: AudioDeviceKind): AudioDevice | undefined {
    const explicit = this.explicitDefaults.get(kind);
    if (explicit) {
      const device = this.devices.find((d) => d.id === explicit && d.kind === kind);
      if (device) return device;
    }
    return (
      this.devices.find((d) => d.kind === kind && d.isDefault) ??
      this.devices.find((d) => d.kind === kind)
    );
  }

  /** User-driven override, e.g. picking a specific Bluetooth headset over the OS default. */
  setDefault(kind: AudioDeviceKind, deviceId: string): void {
    const exists = this.devices.some((d) => d.id === deviceId && d.kind === kind);
    if (!exists) throw new Error(`no ${kind} device with id "${deviceId}" is currently known`);
    this.explicitDefaults.set(kind, deviceId);
  }

  async hasPermission(kind: AudioDeviceKind): Promise<boolean> {
    return this.source.hasPermission(kind);
  }

  async requestPermission(kind: AudioDeviceKind): Promise<boolean> {
    const granted = await this.source.requestPermission(kind);
    log.info("permission request", { kind, granted });
    return granted;
  }
}

export function createAudioDeviceManager(
  source: AudioDeviceSource,
  eventBus?: EventBus,
): AudioDeviceManager {
  return new AudioDeviceManager(source, eventBus);
}
