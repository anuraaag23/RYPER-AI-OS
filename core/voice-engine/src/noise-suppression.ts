import type { AudioFrame } from "./types.js";

export interface NoiseSuppressor {
  process(frame: AudioFrame): AudioFrame;
  reset(): void;
}

export interface NoiseGateOptions {
  /** Samples with absolute amplitude below this are zeroed instead of passed through. */
  readonly gateThreshold?: number;
}

/**
 * A real, if modest, DSP chain: removes DC offset (a running mean
 * subtracted per frame) and applies a hard noise gate below a configurable
 * amplitude. This measurably reduces constant low-level hiss/hum without
 * needing a model. Full spectral suppression (RNNoise-class) needs a
 * native/WASM library — inject one behind the same `NoiseSuppressor`
 * interface (mirrors this codebase's `OnnxSession`/`HttpFetch` injection
 * pattern) when available; callers never need to know which is active.
 */
export class BasicNoiseSuppressor implements NoiseSuppressor {
  private readonly gateThreshold: number;
  private runningMean = 0;
  private hasSeenFrame = false;

  constructor(options: NoiseGateOptions = {}) {
    this.gateThreshold = options.gateThreshold ?? 150;
  }

  process(frame: AudioFrame): AudioFrame {
    const mean = frame.samples.reduce((sum, s) => sum + s, 0) / Math.max(1, frame.samples.length);
    this.runningMean = this.hasSeenFrame ? this.runningMean * 0.9 + mean * 0.1 : mean;
    this.hasSeenFrame = true;

    const output = new Int16Array(frame.samples.length);
    for (let i = 0; i < frame.samples.length; i++) {
      const centered = frame.samples[i]! - this.runningMean;
      output[i] = Math.abs(centered) < this.gateThreshold ? 0 : Math.round(centered);
    }

    return { samples: output, sampleRateHz: frame.sampleRateHz };
  }

  reset(): void {
    this.runningMean = 0;
    this.hasSeenFrame = false;
  }
}

export function createBasicNoiseSuppressor(options?: NoiseGateOptions): BasicNoiseSuppressor {
  return new BasicNoiseSuppressor(options);
}
