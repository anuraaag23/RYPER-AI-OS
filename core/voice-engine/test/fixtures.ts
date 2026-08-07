import type { AudioFrame, AudioDevice } from "../src/types.js";

export function silentFrame(length = 160, sampleRateHz = 16000): AudioFrame {
  return { samples: new Int16Array(length), sampleRateHz };
}

export function toneFrame(amplitude: number, length = 160, sampleRateHz = 16000): AudioFrame {
  const samples = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    samples[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 440 * i) / sampleRateHz));
  }
  return { samples, sampleRateHz };
}

export function sampleDevice(overrides: Partial<AudioDevice> = {}): AudioDevice {
  return {
    id: "mic-1",
    name: "Built-in Microphone",
    kind: "microphone",
    transport: "builtin",
    isDefault: true,
    supportedSampleRatesHz: [16000, 44100],
    ...overrides,
  };
}

export async function collectFrames(iter: AsyncIterable<AudioFrame>): Promise<AudioFrame[]> {
  const out: AudioFrame[] = [];
  for await (const frame of iter) out.push(frame);
  return out;
}
