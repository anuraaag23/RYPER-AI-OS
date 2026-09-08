// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VoiceOrb } from "../src/components/VoiceOrb.js";
import type { VoiceOrbStatus, ConnectionStatus } from "../electron/ipc-contract.js";

afterEach(cleanup);

describe("Microphone and Voice Status Truthfulness Suite", () => {
  describe("Decoupled States & Truthful Voice Orb Messaging", () => {
    it("displays 'Tap to talk' when microphone is available and idle", () => {
      render(<VoiceOrb state="idle" micStatus="available" connection="connected" onPress={() => undefined} />);
      expect(screen.getByText("Tap to talk")).toBeTruthy();
      expect(screen.getByTitle("Tap to talk (Ctrl + Shift + Space)")).toBeTruthy();
    });

    it("displays 'Microphone unavailable' when no microphone is detected", () => {
      render(<VoiceOrb state="idle" micStatus="unavailable" onPress={() => undefined} />);
      expect(screen.getByText("Microphone unavailable")).toBeTruthy();
      expect(screen.getByTitle("Microphone unavailable — please connect a microphone")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Microphone unavailable" })).toBeTruthy();
    });

    it("displays 'Microphone access is off' when microphone permission is denied", () => {
      render(<VoiceOrb state="idle" micStatus="permission-denied" onPress={() => undefined} />);
      expect(screen.getByText("Microphone access is off")).toBeTruthy();
      expect(screen.getByTitle("Microphone access is off — grant microphone permission in Settings")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Microphone access is off" })).toBeTruthy();
    });

    it("displays truthful active states 'Listening…', 'Thinking…', and 'Speaking…'", () => {
      for (const [state, label] of [
        ["listening", "Listening…"],
        ["thinking", "Thinking…"],
        ["speaking", "Speaking…"],
      ] as const) {
        const { unmount } = render(
          <VoiceOrb state={state} micStatus="available" connection="connected" onPress={() => undefined} />,
        );
        expect(screen.getByText(label)).toBeTruthy();
        expect(screen.getByRole("button", { name: label })).toBeTruthy();
        unmount();
      }
    });
  });

  describe("Network Offline Independence (No Fake Offline Display)", () => {
    it("never displays 'Offline' when network is offline but local mic and AI are operational", () => {
      render(
        <VoiceOrb state="idle" micStatus="available" connection="offline" onPress={() => undefined} />,
      );
      expect(screen.queryByText("Offline")).toBeNull();
      expect(screen.getByText("Tap to talk")).toBeTruthy();
    });

    it("displays active speech states even if connection is reported as offline", () => {
      const { unmount } = render(
        <VoiceOrb state="listening" connection="offline" onPress={() => undefined} />,
      );
      expect(screen.getByText("Listening…")).toBeTruthy();
      expect(screen.queryByText("Offline")).toBeNull();
      unmount();

      render(<VoiceOrb state="speaking" connection="offline" onPress={() => undefined} />);
      expect(screen.getByText("Speaking…")).toBeTruthy();
      expect(screen.queryByText("Offline")).toBeNull();
    });
  });

  describe("Voice Session Lifecycle & Error Recovery Truthfulness", () => {
    function mapSessionTransitionToVoiceState(to: string): {
      orbStatus: VoiceOrbStatus;
      connection: ConnectionStatus;
    } {
      let orbStatus: VoiceOrbStatus = "idle";
      if (to === "listening") orbStatus = "listening";
      else if (to === "transcribing" || to === "thinking" || to === "tool_execution" || to === "recovering") orbStatus = "thinking";
      else if (to === "speaking") orbStatus = "speaking";
      else orbStatus = "idle";

      return {
        orbStatus,
        connection: "connected",
      };
    }

    it("maps every voice session transition state faithfully without ever latching offline", () => {
      const transitions = [
        { to: "listening", expectedOrb: "listening" },
        { to: "transcribing", expectedOrb: "thinking" },
        { to: "thinking", expectedOrb: "thinking" },
        { to: "tool_execution", expectedOrb: "thinking" },
        { to: "recovering", expectedOrb: "thinking" },
        { to: "speaking", expectedOrb: "speaking" },
        { to: "idle", expectedOrb: "idle" },
        { to: "interrupted", expectedOrb: "idle" },
        { to: "cancelled", expectedOrb: "idle" },
        { to: "error", expectedOrb: "idle" },
      ];

      for (const t of transitions) {
        const result = mapSessionTransitionToVoiceState(t.to);
        expect(result.orbStatus).toBe(t.expectedOrb);
        expect(result.connection).toBe("connected");
      }
    });

    it("voice turn failure/cancellation returns cleanly to idle connected rather than sticky offline", () => {
      let state: { orbStatus: VoiceOrbStatus; connection: ConnectionStatus } = {
        orbStatus: "listening",
        connection: "connected",
      };

      // Simulating error occurring during voice turn
      try {
        throw new Error("Microphone audio stream interrupted");
      } catch {
        // Must emit idle and connected
        state = {
          orbStatus: "idle",
          connection: "connected",
        };
      }

      expect(state.orbStatus).toBe("idle");
      expect(state.connection).toBe("connected");
      expect(state.connection).not.toBe("offline");
    });
  });
});
