import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { WakeWordEngine } from "../../src/wake-word/engine.js";
import type { WakeWordProvider } from "../../src/wake-word/types.js";
import { silentFrame } from "../fixtures.js";

function fakeProvider(id: string, wakeWord: string, confidence: number): WakeWordProvider {
  let sensitivity = 0;
  return {
    id,
    supportedWakeWords: [wakeWord],
    setSensitivity: (s) => {
      sensitivity = s;
    },
    process: () =>
      confidence >= sensitivity
        ? { wakeWord, confidence, detectedAt: new Date().toISOString() }
        : undefined,
    reset: () => {},
  };
}

describe("WakeWordEngine", () => {
  it("returns a detection when confidence clears sensitivity", () => {
    const engine = new WakeWordEngine([fakeProvider("p1", "Hey Ryper", 0.9)]);
    engine.setSensitivity(0.5);
    const detection = engine.processFrame(silentFrame());
    expect(detection?.wakeWord).toBe("Hey Ryper");
  });

  it("suppresses a detection below the sensitivity threshold", () => {
    const engine = new WakeWordEngine([fakeProvider("p1", "Hey Ryper", 0.3)]);
    engine.setSensitivity(0.5);
    expect(engine.processFrame(silentFrame())).toBeUndefined();
  });

  it("applies a cooldown after a detection to prevent rapid repeat triggers", () => {
    const engine = new WakeWordEngine([fakeProvider("p1", "Hey Ryper", 0.9)], undefined, {
      cooldownMs: 1000,
    });
    engine.setSensitivity(0.1);
    const now = 1000;
    expect(engine.processFrame(silentFrame(), now)).toBeDefined();
    expect(engine.processFrame(silentFrame(), now + 500)).toBeUndefined(); // still within cooldown
    expect(engine.processFrame(silentFrame(), now + 1500)).toBeDefined(); // cooldown elapsed
  });

  it("checks multiple providers and returns the first that clears sensitivity", () => {
    const engine = new WakeWordEngine([
      fakeProvider("p1", "Alexa", 0.1),
      fakeProvider("p2", "Hey Ryper", 0.9),
    ]);
    engine.setSensitivity(0.5);
    expect(engine.processFrame(silentFrame())?.wakeWord).toBe("Hey Ryper");
  });

  it("setEnabled(false) suppresses all detections and resets provider state", () => {
    const engine = new WakeWordEngine([fakeProvider("p1", "Hey Ryper", 0.9)]);
    engine.setSensitivity(0.1);
    engine.setEnabled(false);
    expect(engine.processFrame(silentFrame())).toBeUndefined();
    expect(engine.isEnabled()).toBe(false);
  });

  it("emits a wake_word_detected event on the bus", async () => {
    const eventBus = new EventBus();
    let received: unknown;
    eventBus.on("voice_engine.wake_word_detected", (event) => {
      received = event.payload;
    });
    const engine = new WakeWordEngine([fakeProvider("p1", "Hey Ryper", 0.9)], eventBus);
    engine.setSensitivity(0.1);
    engine.processFrame(silentFrame());
    await Promise.resolve();
    expect(received).toMatchObject({ wakeWord: "Hey Ryper" });
  });

  it("listSupportedWakeWords aggregates across providers without duplicates", () => {
    const engine = new WakeWordEngine([
      fakeProvider("p1", "Ryper", 0.9),
      fakeProvider("p2", "Ryper", 0.9),
    ]);
    expect(engine.listSupportedWakeWords()).toEqual(["Ryper"]);
  });
});
