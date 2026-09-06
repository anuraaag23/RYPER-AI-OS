/**
 * Real Web Audio hardware runs at whatever rate the OS/device negotiates
 * (commonly 44100Hz or 48000Hz) — `AudioContext`'s sample rate cannot be
 * forced to an arbitrary value in every browser. `@ryper/voice-engine`'s
 * `MicrophoneManager.startCapture()` is called with a specific rate (STT
 * providers expect 16000Hz). This linear-interpolation resampler bridges
 * the two for real, in the renderer, rather than lying about the
 * hardware's actual rate. Kept as a pure function (no `AudioContext`,
 * no DOM) so it's directly unit-testable in the Node test environment.
 */
export function resamplePcm16(input: Int16Array, fromRateHz: number, toRateHz: number): Int16Array {
  if (fromRateHz <= 0 || toRateHz <= 0) {
    throw new Error(`sample rates must be positive (got ${fromRateHz}Hz -> ${toRateHz}Hz)`);
  }
  if (fromRateHz === toRateHz || input.length === 0) return input;

  const ratio = fromRateHz / toRateHz;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const idx0 = Math.min(Math.floor(srcPos), input.length - 1);
    const idx1 = Math.min(idx0 + 1, input.length - 1);
    const frac = srcPos - idx0;
    const sample = (input[idx0] as number) * (1 - frac) + (input[idx1] as number) * frac;
    output[i] = Math.max(-32768, Math.min(32767, Math.round(sample)));
  }

  return output;
}

/** Converts Web Audio's native `Float32Array` (range [-1, 1]) samples to 16-bit PCM. */
export function floatTo16BitPcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] as number));
    output[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return output;
}
