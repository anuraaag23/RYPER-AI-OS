// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceOrb } from "../src/components/VoiceOrb.js";

afterEach(cleanup);

describe("VoiceOrb", () => {
  it("renders the idle state caption when microphone is available", () => {
    render(<VoiceOrb state="idle" micStatus="available" onPress={() => undefined} />);
    expect(screen.getByText("Tap to talk")).toBeTruthy();
  });

  it("renders truthful active captions even if network is degraded or offline", () => {
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

  it("shows Microphone unavailable when microphone hardware is unavailable in idle state", () => {
    render(<VoiceOrb state="idle" micStatus="unavailable" onPress={() => undefined} />);
    expect(screen.getByText("Microphone unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Microphone unavailable" })).toBeTruthy();
  });

  it("shows Microphone access is off when microphone permission is denied in idle state", () => {
    render(<VoiceOrb state="idle" micStatus="permission-denied" onPress={() => undefined} />);
    expect(screen.getByText("Microphone access is off")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Microphone access is off" })).toBeTruthy();
  });

  it("shows Reconnecting… when connection is degraded in idle state", () => {
    render(
      <VoiceOrb state="idle" micStatus="available" connection="degraded" onPress={() => undefined} />,
    );
    expect(screen.getByText("Reconnecting…")).toBeTruthy();
  });

  it("calls onPress when clicked", () => {
    const onPress = vi.fn();
    render(<VoiceOrb state="idle" connection="connected" onPress={onPress} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("reflects each real VoiceOrbState in its class name and aria-pressed state", () => {
    for (const state of ["idle", "listening", "thinking", "speaking"] as const) {
      const { unmount } = render(
        <VoiceOrb state={state} connection="connected" onPress={() => undefined} />,
      );
      const button = screen.getByRole("button");
      expect(button.className).toContain(`voice-orb--${state}`);
      expect(button.getAttribute("aria-pressed")).toBe(state === "idle" ? "false" : "true");
      unmount();
    }
  });

  it("gives the button a real accessible name matching the visible caption, for screen reader users", () => {
    render(<VoiceOrb state="listening" connection="connected" onPress={() => undefined} />);
    expect(screen.getByRole("button", { name: "Listening…" })).toBeTruthy();
  });
});
