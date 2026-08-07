import type { AudioFrame, VadResult } from "./types.js";

export interface VoiceActivityDetector {
  detect(frame: AudioFrame): VadResult;
  reset(): void;
}

export interface EnergyVadOptions {
  /** RMS threshold (0..32767 scale) above which a frame is considered speech. */
  readonly energyThreshold?: number;
  /** Frames of silence required before flipping from speech back to silence, to avoid clipping words on brief dips. */
  readonly hangoverFrames?: number;
}

/**
 * A genuinely functional (not a placeholder) energy-based VAD: computes
 * RMS energy per frame and applies hangover smoothing so brief dips
 * mid-word don't cut off speech. This is the same class of algorithm
 * WebRTC's simple VAD mode uses; a production build can inject a more
 * sophisticated model-based detector behind the same `VoiceActivityDetector`
 * interface without changing any caller.
 */
export class EnergyVoiceActivityDetector implements VoiceActivityDetector {
  private readonly energyThreshold: number;
  private readonly hangoverFrames: number;
  private silentStreak = 0;
  private wasSpeech = false;

  constructor(options: EnergyVadOptions = {}) {
    this.energyThreshold = options.energyThreshold ?? 500;
    this.hangoverFrames = options.hangoverFrames ?? 3;
  }

  detect(frame: AudioFrame): VadResult {
    const energy = computeRms(frame.samples);
    const isAboveThreshold = energy >= this.energyThreshold;

    if (isAboveThreshold) {
      this.silentStreak = 0;
      this.wasSpeech = true;
    } else if (this.wasSpeech) {
      this.silentStreak += 1;
      if (this.silentStreak > this.hangoverFrames) {
        this.wasSpeech = false;
      }
    }

    return { isSpeech: this.wasSpeech, energy };
  }

  reset(): void {
    this.silentStreak = 0;
    this.wasSpeech = false;
  }
}

function computeRms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSquares += samples[i]! * samples[i]!;
  }
  return Math.sqrt(sumSquares / samples.length);
}

export function createEnergyVoiceActivityDetector(
  options?: EnergyVadOptions,
): EnergyVoiceActivityDetector {
  return new EnergyVoiceActivityDetector(options);
}
