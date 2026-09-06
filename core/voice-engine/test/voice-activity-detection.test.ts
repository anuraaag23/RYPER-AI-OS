import { describe, expect, it } from "vitest";
import { EnergyVoiceActivityDetector } from "../src/voice-activity-detection.js";
import { silentFrame, toneFrame } from "./fixtures.js";

describe("EnergyVoiceActivityDetector", () => {
  it("classifies silence as not-speech", () => {
    const vad = new EnergyVoiceActivityDetector();
    const result = vad.detect(silentFrame());
    expect(result.isSpeech).toBe(false);
    expect(result.energy).toBe(0);
  });

  it("classifies a loud tone as speech", () => {
    const vad = new EnergyVoiceActivityDetector({ energyThreshold: 500 });
    const result = vad.detect(toneFrame(10000));
    expect(result.isSpeech).toBe(true);
  });

  it("applies hangover smoothing across brief dips after speech starts", () => {
    const vad = new EnergyVoiceActivityDetector({ energyThreshold: 500, hangoverFrames: 2 });
    expect(vad.detect(toneFrame(10000)).isSpeech).toBe(true);
    expect(vad.detect(silentFrame()).isSpeech).toBe(true); // 1 silent frame, within hangover
    expect(vad.detect(silentFrame()).isSpeech).toBe(true); // 2nd silent frame, still within hangover
    expect(vad.detect(silentFrame()).isSpeech).toBe(false); // 3rd, past hangover
  });

  it("reset() clears the speech/hangover state", () => {
    const vad = new EnergyVoiceActivityDetector({ energyThreshold: 500 });
    vad.detect(toneFrame(10000));
    vad.reset();
    expect(vad.detect(silentFrame()).isSpeech).toBe(false);
  });
});
