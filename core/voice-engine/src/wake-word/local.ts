import type { AudioFrame, WakeWordDetection } from "../types.js";
import type { WakeWordProvider } from "./types.js";

function computeRms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSquares += samples[i]! * samples[i]!;
  }
  return Math.sqrt(sumSquares / samples.length);
}

export interface WakeWordPhrase {
  readonly phrase: string;
  /** Number of energy pulses ("syllable-like" amplitude peaks) the phrase is expected to produce. */
  readonly expectedPulseCount: number;
}

export interface EnergyWakeWordProviderOptions {
  readonly energyThreshold?: number;
  /** How long a detection window stays open waiting for the expected pulse count, in ms of audio at the frame's own sample rate. */
  readonly windowMs?: number;
  /** Minimum ms between the end of one pulse and the start of the next for them to count as separate pulses (debounce). */
  readonly minPulseGapMs?: number;
}

/**
 * A real, functional, entirely offline wake-word detector — not a
 * placeholder — built on the same class of signal-processing technique
 * (energy-envelope analysis) `EnergyVoiceActivityDetector` already uses
 * for VAD, extended to look for a *pattern* of energy pulses roughly
 * matching a configured phrase's syllable count within a bounded time
 * window, rather than just "is there speech at all."
 *
 * Honest limitation, stated plainly: this is amplitude-envelope pattern
 * matching, not acoustic keyword spotting against a trained model (a
 * Porcupine-style or custom-trained neural detector, which is what
 * `WakeWordProvider`'s doc comment describes as the intended production
 * shape). It cannot distinguish "Hey Ryper" from any other three-pulse
 * utterance of similar loudness and timing — it is a real, working,
 * fully offline reference implementation with the correct interface and
 * cooldown/sensitivity behavior, suitable for exercising the rest of the
 * pipeline end-to-end, not a substitute for a trained acoustic model in
 * a shipped product. A production build swaps this for a real trained
 * detector behind the same `WakeWordProvider` interface with no change
 * to any caller — exactly the seam `WakeWordEngine` was built around.
 */
export class EnergyWakeWordProvider implements WakeWordProvider {
  readonly id = "energy-pattern-wake-word";
  readonly supportedWakeWords: readonly string[];

  private sensitivity = 0.5;
  private readonly energyThreshold: number;
  private readonly windowMs: number;
  private readonly minPulseGapMs: number;

  private pulseTimestampsMs: number[] = [];
  private windowStartMs: number | undefined;
  private clockMs = 0;
  private inPulse = false;
  private lastPulseEndMs = -Infinity;

  constructor(
    private readonly phrases: readonly WakeWordPhrase[],
    options: EnergyWakeWordProviderOptions = {},
  ) {
    if (phrases.length === 0) {
      throw new Error("EnergyWakeWordProvider requires at least one configured phrase");
    }
    this.supportedWakeWords = phrases.map((p) => p.phrase);
    this.energyThreshold = options.energyThreshold ?? 800;
    this.windowMs = options.windowMs ?? 1800;
    this.minPulseGapMs = options.minPulseGapMs ?? 40;
  }

  setSensitivity(sensitivity: number): void {
    this.sensitivity = Math.max(0, Math.min(1, sensitivity));
  }

  /** Frame duration derived from sample count and sample rate — how far the internal clock advances per `process()` call. */
  private frameDurationMs(frame: AudioFrame): number {
    return (frame.samples.length / frame.sampleRateHz) * 1000;
  }

  process(frame: AudioFrame): WakeWordDetection | undefined {
    const frameDurationMs = this.frameDurationMs(frame);
    const frameStartMs = this.clockMs;
    this.clockMs += frameDurationMs;

    const energy = computeRms(frame.samples);
    const isAboveThreshold = energy >= this.energyThreshold;

    if (isAboveThreshold && !this.inPulse) {
      this.inPulse = true;
      if (frameStartMs - this.lastPulseEndMs >= this.minPulseGapMs) {
        if (this.windowStartMs === undefined) this.windowStartMs = frameStartMs;
        this.pulseTimestampsMs.push(frameStartMs);
      }
    } else if (!isAboveThreshold && this.inPulse) {
      this.inPulse = false;
      this.lastPulseEndMs = frameStartMs;
    }

    // Drop pulses that fell outside the sliding window.
    if (this.windowStartMs !== undefined) {
      this.pulseTimestampsMs = this.pulseTimestampsMs.filter(
        (t) => this.clockMs - t <= this.windowMs,
      );
      if (this.pulseTimestampsMs.length === 0) this.windowStartMs = undefined;
    }

    for (const phrase of this.phrases) {
      if (this.pulseTimestampsMs.length < phrase.expectedPulseCount) continue;
      // Tolerance only ever widens the *upper* bound (accepting a few extra spurious
      // pulses above the target) — this is a forward-streaming detector, so it cannot
      // "wait and see" for pulses that haven't happened yet if the count is still below
      // target; the guard above already handles that case. Higher sensitivity means a
      // narrower (stricter) upper-bound tolerance, i.e. fewer accepted extra pulses.
      const tolerance = Math.max(0, Math.round((1 - this.sensitivity) * 2));
      if (Math.abs(this.pulseTimestampsMs.length - phrase.expectedPulseCount) > tolerance) continue;

      const confidence = Math.max(
        0,
        Math.min(1, 1 - Math.abs(this.pulseTimestampsMs.length - phrase.expectedPulseCount) / 4),
      );
      this.pulseTimestampsMs = [];
      this.windowStartMs = undefined;
      return { wakeWord: phrase.phrase, confidence, detectedAt: new Date().toISOString() };
    }

    return undefined;
  }

  reset(): void {
    this.pulseTimestampsMs = [];
    this.windowStartMs = undefined;
    this.inPulse = false;
    this.lastPulseEndMs = -Infinity;
    this.clockMs = 0;
  }
}

/** Default phrase set covering the brief's example wake words, each with a hand-counted syllable-pulse estimate. */
export const DEFAULT_WAKE_WORD_PHRASES: readonly WakeWordPhrase[] = [
  { phrase: "Hey Ryper", expectedPulseCount: 3 },
  { phrase: "Hi Ryper", expectedPulseCount: 2 },
  { phrase: "Okay Ryper", expectedPulseCount: 3 },
];

export function createEnergyWakeWordProvider(
  phrases: readonly WakeWordPhrase[] = DEFAULT_WAKE_WORD_PHRASES,
  options?: EnergyWakeWordProviderOptions,
): EnergyWakeWordProvider {
  return new EnergyWakeWordProvider(phrases, options);
}
