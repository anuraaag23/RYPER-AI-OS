import { describe, expect, it } from "vitest";
import { EnergyWakeWordProvider, DEFAULT_WAKE_WORD_PHRASES } from "../../src/wake-word/local.js";
import { silentFrame, toneFrame } from "../fixtures.js";

/** Builds a sequence of frames with `pulseCount` loud pulses separated by silence, within the detection window. */
function buildPulseSequence(
  pulseCount: number,
  framesPerPulse = 3,
  gapFrames = 8,
): ReturnType<typeof toneFrame>[] {
  const frames: ReturnType<typeof toneFrame>[] = [];
  for (let i = 0; i < pulseCount; i++) {
    for (let f = 0; f < framesPerPulse; f++) frames.push(toneFrame(20000));
    for (let f = 0; f < gapFrames; f++) frames.push(silentFrame());
  }
  return frames;
}

describe("EnergyWakeWordProvider", () => {
  it("requires at least one configured phrase", () => {
    expect(() => new EnergyWakeWordProvider([])).toThrow();
  });

  it("reports its supported wake words from the configured phrase list", () => {
    const provider = new EnergyWakeWordProvider(DEFAULT_WAKE_WORD_PHRASES);
    expect(provider.supportedWakeWords).toEqual(["Hey Ryper", "Hi Ryper", "Okay Ryper"]);
  });

  it("detects a phrase when the pulse count matches exactly", () => {
    const provider = new EnergyWakeWordProvider([{ phrase: "Hi Ryper", expectedPulseCount: 2 }]);
    provider.setSensitivity(0.5);
    let detection;
    for (const frame of buildPulseSequence(2)) {
      detection = provider.process(frame) ?? detection;
    }
    expect(detection?.wakeWord).toBe("Hi Ryper");
    expect(detection?.confidence).toBeGreaterThan(0);
  });

  it("does not detect when far fewer pulses occur than expected", () => {
    const provider = new EnergyWakeWordProvider([{ phrase: "Hey Ryper", expectedPulseCount: 3 }]);
    provider.setSensitivity(0.9); // narrow tolerance band
    let detection;
    for (const frame of buildPulseSequence(1)) {
      detection = provider.process(frame) ?? detection;
    }
    expect(detection).toBeUndefined();
  });

  it("reports full confidence for an exact pulse-count match", () => {
    const provider = new EnergyWakeWordProvider([{ phrase: "Hey Ryper", expectedPulseCount: 3 }]);
    provider.setSensitivity(1);
    let detection;
    for (const frame of buildPulseSequence(3)) {
      detection = provider.process(frame) ?? detection;
    }
    expect(detection?.confidence).toBe(1);
  });

  it("a low sensitivity setting still requires the pulse count to reach the phrase's target", () => {
    const provider = new EnergyWakeWordProvider([{ phrase: "Hey Ryper", expectedPulseCount: 3 }]);
    provider.setSensitivity(0.1);
    let detection;
    for (const frame of buildPulseSequence(2)) {
      detection = provider.process(frame) ?? detection;
    }
    // A streaming detector can't "wait and see" for pulses that never come — reaching only 2 of 3
    // required pulses never matches, regardless of tolerance, since tolerance only ever widens the
    // *upper* bound (extra spurious pulses), not the lower one.
    expect(detection).toBeUndefined();
  });

  it("does not detect from pure silence", () => {
    const provider = new EnergyWakeWordProvider(DEFAULT_WAKE_WORD_PHRASES);
    let detection;
    for (let i = 0; i < 50; i++) {
      detection = provider.process(silentFrame()) ?? detection;
    }
    expect(detection).toBeUndefined();
  });

  it("reset() clears in-progress pulse tracking", () => {
    const provider = new EnergyWakeWordProvider([{ phrase: "Hi Ryper", expectedPulseCount: 2 }]);
    provider.setSensitivity(0.5);
    // First pulse only, then reset before the second pulse would complete the pattern.
    for (const frame of buildPulseSequence(1)) provider.process(frame);
    provider.reset();
    let detection;
    for (const frame of buildPulseSequence(1)) {
      detection = provider.process(frame) ?? detection;
    }
    expect(detection).toBeUndefined();
  });

  it("distinguishes phrases by expected pulse count when multiple are configured", () => {
    const provider = new EnergyWakeWordProvider(DEFAULT_WAKE_WORD_PHRASES);
    provider.setSensitivity(0.7);
    let detection;
    for (const frame of buildPulseSequence(2)) {
      detection = provider.process(frame) ?? detection;
    }
    expect(detection?.wakeWord).toBe("Hi Ryper");
  });
});
