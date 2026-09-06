import type { AudioFrame, WakeWordDetection } from "../types.js";

/**
 * A wake-word engine implementation (Porcupine-style keyword spotter, a
 * platform's native on-device model, a custom-trained one). Runs entirely
 * offline by contract — cloud wake-word detection defeats the point (low
 * latency, no network dependency, privacy) and isn't supported here.
 */
export interface WakeWordProvider {
  readonly id: string;
  readonly supportedWakeWords: readonly string[];
  /** 0..1 — higher rejects more false positives at the cost of more false negatives. */
  setSensitivity(sensitivity: number): void;
  process(frame: AudioFrame): WakeWordDetection | undefined;
  reset(): void;
}
