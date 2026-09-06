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

  it("follows the full happy path: idle -> listening -> transcribing -> thinking -> speaking -> idle", () => {
    const manager = new VoiceSessionManager();
    manager.transition("listening");
    manager.transition("transcribing");
    manager.transition("thinking");
    manager.transition("speaking");
    const final = manager.transition("idle");
    expect(final.state).toBe("idle");
  });

  it("supports a tool-execution round within thinking: thinking -> tool_execution -> thinking", () => {
    const manager = new VoiceSessionManager();
    manager.transition("listening");
    manager.transition("transcribing");
    manager.transition("thinking");
    manager.transition("tool_execution");
    const back = manager.transition("thinking");
    expect(back.state).toBe("thinking");
  });

  it("supports an automatic-retry round: thinking -> recovering -> thinking", () => {
    const manager = new VoiceSessionManager();
    manager.transition("listening");
    manager.transition("transcribing");
    manager.transition("thinking");
    manager.transition("recovering");
    const back = manager.transition("thinking");
    expect(back.state).toBe("thinking");
  });

  it("supports real barge-in: speaking -> interrupted -> listening (continuing the turn)", () => {
    const manager = new VoiceSessionManager();
    manager.transition("listening");
    manager.transition("transcribing");
    manager.transition("thinking");
    manager.transition("speaking");
    manager.transition("interrupted");
    const continued = manager.transition("listening");
    expect(continued.state).toBe("listening");
  });

  it("supports barge-in resolving straight to idle when no continuation follows", () => {
    const manager = new VoiceSessionManager();
    manager.transition("listening");
    manager.transition("transcribing");
    manager.transition("thinking");
    manager.transition("speaking");
    manager.transition("interrupted");
    const final = manager.transition("idle");
    expect(final.state).toBe("idle");
  });

  it("rejects an invalid transition", () => {
    const manager = new VoiceSessionManager();
    expect(() => manager.transition("speaking")).toThrow(InvalidVoiceSessionTransitionError);
  });

  it("rejects skipping transcribing (listening cannot go straight to thinking)", () => {
    const manager = new VoiceSessionManager();
    manager.transition("listening");
    expect(() => manager.transition("thinking")).toThrow(InvalidVoiceSessionTransitionError);
  });

  it("a fresh session gets a new sessionId once returning to idle", () => {
    const manager = new VoiceSessionManager();
    const before = manager.getSnapshot().sessionId;
    manager.transition("listening");
    manager.transition("transcribing");
    manager.transition("thinking");
    manager.transition("idle");
    expect(manager.getSnapshot().sessionId).not.toBe(before);
  });

  it("cancel() is a no-op when already idle, otherwise transitions to cancelled", () => {
    const manager = new VoiceSessionManager();
    expect(manager.cancel().state).toBe("idle");

    manager.transition("listening");
    expect(manager.cancel().state).toBe("cancelled");
  });

  it("cancel() reaches cancelled from every busy state, not just listening", () => {
    const busyStates = [
      "listening",
      "transcribing",
      "thinking",
      "tool_execution",
      "recovering",
      "speaking",
      "interrupted",
    ] as const;

    for (const target of busyStates) {
      const manager = new VoiceSessionManager();
      manager.transition("listening");
      if (target !== "listening") manager.transition("transcribing");
      if (!["listening", "transcribing"].includes(target)) manager.transition("thinking");
      if (target === "tool_execution") manager.transition("tool_execution");
      if (target === "recovering") manager.transition("recovering");
      if (target === "speaking" || target === "interrupted") manager.transition("speaking");
      if (target === "interrupted") manager.transition("interrupted");

      expect(manager.getSnapshot().state).toBe(target);
      expect(manager.cancel().state).toBe("cancelled");
    }
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
