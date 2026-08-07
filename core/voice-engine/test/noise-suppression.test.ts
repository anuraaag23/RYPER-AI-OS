import { describe, expect, it } from "vitest";
import { BasicNoiseSuppressor } from "../src/noise-suppression.js";
import { toneFrame } from "./fixtures.js";
import type { AudioFrame } from "../src/types.js";

describe("BasicNoiseSuppressor", () => {
  it("zeroes out low-amplitude samples (the noise gate)", () => {
    const suppressor = new BasicNoiseSuppressor({ gateThreshold: 1000 });
    const quiet: AudioFrame = { samples: new Int16Array([10, -10, 5, -5]), sampleRateHz: 16000 };
    const output = suppressor.process(quiet);
    expect([...output.samples]).toEqual([0, 0, 0, 0]);
  });

  it("passes through samples above the gate threshold", () => {
    const suppressor = new BasicNoiseSuppressor({ gateThreshold: 100 });
    const loud = toneFrame(10000);
    const output = suppressor.process(loud);
    const hasNonZero = [...output.samples].some((s) => s !== 0);
    expect(hasNonZero).toBe(true);
  });

  it("preserves the frame's sample rate", () => {
    const suppressor = new BasicNoiseSuppressor();
    const output = suppressor.process({ samples: new Int16Array(10), sampleRateHz: 44100 });
    expect(output.sampleRateHz).toBe(44100);
  });

  it("reset() clears the running DC-offset estimate", () => {
    const suppressor = new BasicNoiseSuppressor({ gateThreshold: 1 });
    suppressor.process(toneFrame(20000));
    suppressor.reset();
    const silent: AudioFrame = { samples: new Int16Array(5), sampleRateHz: 16000 };
    const output = suppressor.process(silent);
    expect([...output.samples]).toEqual([0, 0, 0, 0, 0]);
  });
});
