import { describe, expect, it } from "vitest";
import { VoiceDiagnostics } from "../src/voice-diagnostics.js";

describe("VoiceDiagnostics", () => {
  it("accumulates stage timings and sums them into totalPipelineMs", () => {
    const diagnostics = new VoiceDiagnostics();
    diagnostics.startSession();
    diagnostics.recordStage("stt", 100);
    diagnostics.recordStage("ai_engine", 250);
    diagnostics.recordStage("tts", 50);

    const snapshot = diagnostics.snapshot();
    expect(snapshot.totalPipelineMs).toBe(400);
    expect(snapshot.lastStageTimings).toHaveLength(3);
  });

  it("startSession() clears timings/errors from the previous session and bumps sessionCount", () => {
    const diagnostics = new VoiceDiagnostics();
    diagnostics.startSession();
    diagnostics.recordStage("stt", 10);
    diagnostics.recordError("boom");

    diagnostics.startSession();
    const snapshot = diagnostics.snapshot();
    expect(snapshot.lastStageTimings).toHaveLength(0);
    expect(snapshot.lastError).toBeUndefined();
    expect(snapshot.sessionCount).toBe(2);
  });

  it("recordError() is reflected in the next snapshot", () => {
    const diagnostics = new VoiceDiagnostics();
    diagnostics.startSession();
    diagnostics.recordError("stt provider unavailable");
    expect(diagnostics.snapshot().lastError).toBe("stt provider unavailable");
  });
});
