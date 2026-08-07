import { createLogger } from "@ryper/logging";
import type { EventBus } from "@ryper/event-bus";
import type { AudioFrame, WakeWordDetection } from "../types.js";
import type { WakeWordProvider } from "./types.js";

const log = createLogger("voice-engine:wake-word");

export interface WakeWordEngineOptions {
  /** Minimum time between accepted detections — the primary false-positive-reduction knob alongside provider sensitivity. */
  readonly cooldownMs?: number;
}

/**
 * Runs every registered provider against each incoming frame (so multiple
 * wake words / multiple engines can be active at once, per the brief's
 * pluggable-providers requirement) and applies a shared cooldown so one
 * loud noise can't trigger a burst of repeated detections. CPU/battery
 * cost is bounded by design: this class does no buffering or resampling
 * of its own — it processes exactly the frames it's handed and does
 * nothing between calls.
 */
export class WakeWordEngine {
  private readonly providers: WakeWordProvider[];
  private enabled = true;
  private sensitivity = 0.5;
  private lastDetectionAt = 0;
  private readonly cooldownMs: number;

  constructor(
    providers: readonly WakeWordProvider[],
    private readonly eventBus?: EventBus,
    options: WakeWordEngineOptions = {},
  ) {
    this.providers = [...providers];
    this.cooldownMs = options.cooldownMs ?? 1500;
    for (const provider of this.providers) provider.setSensitivity(this.sensitivity);
  }

  addProvider(provider: WakeWordProvider): void {
    provider.setSensitivity(this.sensitivity);
    this.providers.push(provider);
  }

  setSensitivity(sensitivity: number): void {
    this.sensitivity = Math.max(0, Math.min(1, sensitivity));
    for (const provider of this.providers) provider.setSensitivity(this.sensitivity);
  }

  getSensitivity(): number {
    return this.sensitivity;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Feed one audio frame; returns a detection only if one clears sensitivity and cooldown, otherwise undefined. */
  processFrame(frame: AudioFrame, now: number = Date.now()): WakeWordDetection | undefined {
    if (!this.enabled) return undefined;
    if (now - this.lastDetectionAt < this.cooldownMs) return undefined;

    for (const provider of this.providers) {
      const detection = provider.process(frame);
      if (detection && detection.confidence >= this.sensitivity) {
        this.lastDetectionAt = now;
        log.info("wake word detected", {
          wakeWord: detection.wakeWord,
          confidence: detection.confidence,
        });
        void this.eventBus?.emit("voice_engine.wake_word_detected", detection, "voice-engine");
        return detection;
      }
    }
    return undefined;
  }

  reset(): void {
    for (const provider of this.providers) provider.reset();
    this.lastDetectionAt = 0;
  }

  listSupportedWakeWords(): readonly string[] {
    return [...new Set(this.providers.flatMap((p) => p.supportedWakeWords))];
  }
}

export function createWakeWordEngine(
  providers: readonly WakeWordProvider[],
  eventBus?: EventBus,
  options?: WakeWordEngineOptions,
): WakeWordEngine {
  return new WakeWordEngine(providers, eventBus, options);
}
