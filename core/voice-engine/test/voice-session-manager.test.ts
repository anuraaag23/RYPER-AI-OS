import { describe, expect, it, vi } from "vitest";
import {
  VoiceSessionManager,
  InvalidVoiceSessionTransitionError,
} from "../src/voice-session-manager.js";

describe("VoiceSessionManager", () => {
  it("starts idle", () => {
    const manager = new VoiceSessionManager();
    expect(manager.getSnapshot().state).toBe("idle");
  });

  it("follows the happy path: idle -> listening -> processing -> speaking -> idle", () => {
    const manager = new VoiceSessionManager();
    manager.transition("listening");
    manager.transition("processing");
    manager.transition("speaking");
    const final = manager.transition("idle");
    expect(final.state).toBe("idle");
  });

  it("rejects an invalid transition", () => {
    const manager = new VoiceSessionManager();
    expect(() => manager.transition("speaking")).toThrow(InvalidVoiceSessionTransitionError);
  });

  it("a fresh session gets a new sessionId once returning to idle", () => {
    const manager = new VoiceSessionManager();
    const before = manager.getSnapshot().sessionId;
    manager.transition("listening");
    manager.transition("processing");
    manager.transition("idle");
    expect(manager.getSnapshot().sessionId).not.toBe(before);
  });

  it("cancel() is a no-op when already idle, otherwise transitions to cancelled", () => {
    const manager = new VoiceSessionManager();
    expect(manager.cancel().state).toBe("idle");

    manager.transition("listening");
    expect(manager.cancel().state).toBe("cancelled");
  });

  it("force-cancels a session that stays in listening past maxListeningMs", async () => {
    vi.useFakeTimers();
    const manager = new VoiceSessionManager({ maxListeningMs: 100 });
    manager.transition("listening");
    vi.advanceTimersByTime(150);
    expect(manager.getSnapshot().state).toBe("cancelled");
    vi.useRealTimers();
  });

  it("dispose() clears any pending timeout without throwing", () => {
    const manager = new VoiceSessionManager({ maxListeningMs: 10_000 });
    manager.transition("listening");
    expect(() => manager.dispose()).not.toThrow();
  });
});
