import { describe, expect, it } from "vitest";
import { NlmsEchoCanceller } from "../src/echo-cancellation.js";
import { toneFrame, silentFrame } from "./fixtures.js";
import type { AudioFrame } from "../src/types.js";

function energy(frame: AudioFrame): number {
  let sum = 0;
  for (const s of frame.samples) sum += s * s;
  return Math.sqrt(sum / frame.samples.length);
}

describe("NlmsEchoCanceller", () => {
  it("converges to substantially reduce a pure-echo signal (mic == reference) over repeated frames", () => {
    const aec = new NlmsEchoCanceller({ filterLength: 32, stepSize: 0.8 });
    const reference = toneFrame(8000, 320);

    let lastOutputEnergy = energy(reference);
    for (let i = 0; i < 30; i++) {
      const output = aec.process(reference, reference);
      lastOutputEnergy = energy(output);
    }

    expect(lastOutputEnergy).toBeLessThan(energy(reference) * 0.5);
  });

  it("passes through mic audio largely unchanged when the reference is silent (nothing to cancel)", () => {
    const aec = new NlmsEchoCanceller({ filterLength: 16 });
    const mic = toneFrame(5000, 160);
    const output = aec.process(mic, silentFrame(160));
    // With a zero reference, the predicted echo is always 0, so output == mic.
    expect([...output.samples]).toEqual([...mic.samples]);
  });

  it("reset() clears adaptive weights back to their initial (no-op) state", () => {
    const aec = new NlmsEchoCanceller({ filterLength: 16 });
    const reference = toneFrame(8000, 160);
    aec.process(reference, reference);
    aec.reset();
    const mic = toneFrame(3000, 160);
    const output = aec.process(mic, silentFrame(160));
    expect([...output.samples]).toEqual([...mic.samples]);
  });

  it("preserves the mic frame's sample rate", () => {
    const aec = new NlmsEchoCanceller({ filterLength: 8 });
    const output = aec.process(
      { samples: new Int16Array(10), sampleRateHz: 48000 },
      silentFrame(10),
    );
    expect(output.sampleRateHz).toBe(48000);
  });
});
