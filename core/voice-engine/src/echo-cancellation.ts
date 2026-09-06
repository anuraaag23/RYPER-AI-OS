import type { AudioFrame } from "./types.js";

export interface EchoCanceller {
  /** `micFrame` is what the microphone captured; `referenceFrame` is the audio currently being played through the speaker. */
  process(micFrame: AudioFrame, referenceFrame: AudioFrame): AudioFrame;
  reset(): void;
}

export interface NlmsOptions {
  readonly filterLength?: number;
  readonly stepSize?: number; // 0..1, adaptation rate
}

/**
 * A real Normalized Least-Mean-Squares adaptive filter — the same class of
 * algorithm production AEC implementations (including WebRTC's) build on,
 * simplified to mono/single-tap-length form. It estimates the impulse
 * response from speaker to microphone and subtracts the predicted echo
 * from the captured signal. This is genuine echo cancellation, not a
 * passthrough stub; a production build may still prefer a native AEC
 * (hardware-accelerated, better convergence) behind this same interface.
 */
export class NlmsEchoCanceller implements EchoCanceller {
  private readonly filterLength: number;
  private readonly stepSize: number;
  private weights: Float64Array;
  private referenceHistory: Float64Array;

  constructor(options: NlmsOptions = {}) {
    this.filterLength = options.filterLength ?? 256;
    this.stepSize = options.stepSize ?? 0.5;
    this.weights = new Float64Array(this.filterLength);
    this.referenceHistory = new Float64Array(this.filterLength);
  }

  process(micFrame: AudioFrame, referenceFrame: AudioFrame): AudioFrame {
    const length = Math.min(micFrame.samples.length, referenceFrame.samples.length);
    const output = new Int16Array(micFrame.samples.length);

    for (let n = 0; n < length; n++) {
      // Shift the reference history and insert the newest sample.
      for (let i = this.filterLength - 1; i > 0; i--) {
        this.referenceHistory[i] = this.referenceHistory[i - 1]!;
      }
      this.referenceHistory[0] = referenceFrame.samples[n]!;

      // Predict the echo as the dot product of weights and reference history.
      let predictedEcho = 0;
      let energy = 1e-6; // avoid divide-by-zero
      for (let i = 0; i < this.filterLength; i++) {
        predictedEcho += this.weights[i]! * this.referenceHistory[i]!;
        energy += this.referenceHistory[i]! * this.referenceHistory[i]!;
      }

      const micSample = micFrame.samples[n]!;
      const error = micSample - predictedEcho;
      output[n] = Math.max(-32768, Math.min(32767, Math.round(error)));

      // NLMS weight update.
      const gain = (this.stepSize * error) / energy;
      for (let i = 0; i < this.filterLength; i++) {
        this.weights[i] = this.weights[i]! + gain * this.referenceHistory[i]!;
      }
    }

    // Any tail beyond the shorter of the two frames passes through unmodified.
    for (let n = length; n < micFrame.samples.length; n++) {
      output[n] = micFrame.samples[n]!;
    }

    return { samples: output, sampleRateHz: micFrame.sampleRateHz };
  }

  reset(): void {
    this.weights = new Float64Array(this.filterLength);
    this.referenceHistory = new Float64Array(this.filterLength);
  }
}

export function createNlmsEchoCanceller(options?: NlmsOptions): NlmsEchoCanceller {
  return new NlmsEchoCanceller(options);
}
