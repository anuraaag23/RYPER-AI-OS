import { describe, expect, it } from "vitest";
import { IntentDetector } from "../src/intent-detection.js";

describe("IntentDetector", () => {
  it("detects open_application with its app slot", () => {
    const detector = new IntentDetector();
    const match = detector.detect("open Spotify");
    expect(match?.intent).toBe("open_application");
    expect(match?.slots.app).toBe("Spotify");
  });

  it("detects search_files with its query slot", () => {
    const detector = new IntentDetector();
    const match = detector.detect("search for quarterly report");
    expect(match?.intent).toBe("search_files");
    expect(match?.slots.query).toBe("quarterly report");
  });

  it("detects create_reminder with its task slot", () => {
    const detector = new IntentDetector();
    const match = detector.detect("remind me to call the dentist");
    expect(match?.intent).toBe("create_reminder");
    expect(match?.slots.task).toBe("call the dentist");
  });

  it("detects control_smart_home with state and device slots", () => {
    const detector = new IntentDetector();
    const match = detector.detect("turn off the living room lights");
    expect(match?.intent).toBe("control_smart_home");
    expect(match?.slots.state).toBe("off");
    expect(match?.slots.device).toBe("living room lights");
  });

  it("returns undefined for conversational speech that matches no command", () => {
    const detector = new IntentDetector();
    expect(detector.detect("what's the capital of France")).toBeUndefined();
  });

  it("prefers an injected custom detector over the default patterns", () => {
    const detector = new IntentDetector(undefined, () => ({
      intent: "custom_intent",
      slots: {},
      confidence: 1,
    }));
    expect(detector.detect("open Spotify")?.intent).toBe("custom_intent");
  });

  it("falls back to default patterns when the custom detector finds no match", () => {
    const detector = new IntentDetector(undefined, () => undefined);
    expect(detector.detect("open Spotify")?.intent).toBe("open_application");
  });
});
