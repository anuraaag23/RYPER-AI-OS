import { describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "@ryper/telemetry";
import { VoiceAnalytics } from "../src/voice-analytics.js";

describe("VoiceAnalytics", () => {
  it("tracks counters locally regardless of telemetry configuration", () => {
    const analytics = new VoiceAnalytics();
    analytics.recordWakeWordTrigger();
    analytics.recordWakeWordTrigger();
    analytics.recordSessionCompleted(1000);
    analytics.recordSessionCancelled();
    analytics.recordCommandHandled();

    const snapshot = analytics.snapshot();
    expect(snapshot.wakeWordTriggers).toBe(2);
    expect(snapshot.sessionsCompleted).toBe(1);
    expect(snapshot.sessionsCancelled).toBe(1);
    expect(snapshot.commandsHandled).toBe(1);
    expect(snapshot.averageSessionMs).toBe(1000);
  });

  it("report() never calls the telemetry transport unless telemetry is explicitly enabled", async () => {
    const transport = vi.fn();
    const telemetry = new TelemetryClient({ enabled: false, transport });
    const analytics = new VoiceAnalytics(telemetry);
    analytics.recordWakeWordTrigger();
    await analytics.report();
    expect(transport).not.toHaveBeenCalled();
  });

  it("report() calls the telemetry transport once telemetry is explicitly enabled", async () => {
    const transport = vi.fn();
    const telemetry = new TelemetryClient({ enabled: true, transport });
    const analytics = new VoiceAnalytics(telemetry);
    analytics.recordWakeWordTrigger();
    await analytics.report();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("report() is a no-op with no telemetry client configured at all", async () => {
    const analytics = new VoiceAnalytics();
    await expect(analytics.report()).resolves.toBeUndefined();
  });
});
