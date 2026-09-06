// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceOrb } from "../src/components/VoiceOrb.js";

afterEach(cleanup);

describe("VoiceOrb", () => {
  it("renders the idle state caption", () => {
    render(<VoiceOrb state="idle" connection="connected" onPress={() => undefined} />);
    expect(screen.getByText("Tap to talk")).toBeTruthy();
  });

  it("shows a connection-status caption instead of the state caption when degraded", () => {
    render(<VoiceOrb state="listening" connection="offline" onPress={() => undefined} />);
    expect(screen.getByText("Offline")).toBeTruthy();
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

  it("announces a connection problem as the button's accessible name too, not just visually", () => {
    render(<VoiceOrb state="speaking" connection="offline" onPress={() => undefined} />);
    expect(screen.getByRole("button", { name: "Offline" })).toBeTruthy();
  });
});
