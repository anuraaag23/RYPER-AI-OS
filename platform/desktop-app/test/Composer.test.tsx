// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../src/components/Composer.js";
import type { AudioDeviceKindPayload, AudioStatusPayload, VoiceStatePayload } from "../electron/ipc-contract.js";

afterEach(cleanup);

/**
 * A minimal, in-memory stand-in for the real `window.ryper` bridge
 * (normally provided by `preload.ts` over real IPC), covering just the
 * voice/audio surface `Composer` now actually calls
 * (`onVoiceState`, `onAudioStatusChanged`, `requestAudioPermission`,
 * `startVoiceTurn`, `stopVoiceTurn`) — enough to drive the microphone
 * control's real logic without a real Electron process.
 */
function buildFakeRyper(overrides: {
  requestAudioPermission?: (kind: AudioDeviceKindPayload) => Promise<boolean>;
}) {
  let voiceStateHandler: ((state: VoiceStatePayload) => void) | undefined;
  let audioStatusHandler: ((status: AudioStatusPayload) => void) | undefined;
  const unsubscribeVoiceState = vi.fn();
  const unsubscribeAudioStatus = vi.fn();

  const fake = {
    startVoiceTurn: vi.fn(async () => undefined),
    stopVoiceTurn: vi.fn(async () => undefined),
    requestAudioPermission:
      overrides.requestAudioPermission ?? vi.fn(async () => true),
    onVoiceState: vi.fn((handler: (state: VoiceStatePayload) => void) => {
      voiceStateHandler = handler;
      return unsubscribeVoiceState;
    }),
    onAudioStatusChanged: vi.fn((handler: (status: AudioStatusPayload) => void) => {
      audioStatusHandler = handler;
      return unsubscribeAudioStatus;
    }),
    // Test-only hooks into the captured handlers/unsubscribe spies —
    // not part of the real `window.ryper` contract.
    __emitVoiceState: (state: VoiceStatePayload) => {
      voiceStateHandler?.(state);
    },
    __emitAudioStatus: (status: AudioStatusPayload) => {
      audioStatusHandler?.(status);
    },
    __unsubscribeVoiceState: unsubscribeVoiceState,
    __unsubscribeAudioStatus: unsubscribeAudioStatus,
  };
  return fake;
}

function installFakeRyper(overrides: Parameters<typeof buildFakeRyper>[0] = {}) {
  const fake = buildFakeRyper(overrides);
  Object.defineProperty(window, "ryper", { value: fake, writable: true, configurable: true });
  return fake;
}

describe("Composer", () => {
  beforeEach(() => {
    installFakeRyper({});
  });

  it("calls onSend with trimmed content and clears the input", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled={false} />);
    const textarea = screen.getByPlaceholderText("Message Ryper…") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "  hello there  " } });
    fireEvent.click(screen.getByText("Send"));
    expect(onSend).toHaveBeenCalledWith("hello there");
    expect(textarea.value).toBe("");
  });

  it("sends on Enter without Shift, but not with Shift", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled={false} />);
    const textarea = screen.getByPlaceholderText("Message Ryper…");
    fireEvent.change(textarea, { target: { value: "line one" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledWith("line one");
  });

  it("does not send empty or whitespace-only content", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled={false} />);
    fireEvent.click(screen.getByText("Send"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables the send button while disabled=true", () => {
    render(<Composer onSend={() => undefined} disabled={true} />);
    expect((screen.getByText("Send") as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders a microphone button with a real accessible name and idle aria-pressed state", () => {
    render(<Composer onSend={() => undefined} disabled={false} />);
    const mic = screen.getByRole("button", { name: "Start voice command" });
    expect(mic.getAttribute("aria-pressed")).toBe("false");
  });

  it("requests microphone permission when the idle mic button is clicked", async () => {
    const fake = installFakeRyper({});
    render(<Composer onSend={() => undefined} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Start voice command" }));
    await waitFor(() => expect(fake.requestAudioPermission).toHaveBeenCalledWith("microphone"));
  });

  it("starts the real voice turn once permission is granted", async () => {
    const fake = installFakeRyper({ requestAudioPermission: vi.fn(async () => true) });
    render(<Composer onSend={() => undefined} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Start voice command" }));
    await waitFor(() => expect(fake.startVoiceTurn).toHaveBeenCalledOnce());
  });

  it("does not start a voice turn, and shows a clear inline error, when permission is denied", async () => {
    const fake = installFakeRyper({ requestAudioPermission: vi.fn(async () => false) });
    render(<Composer onSend={() => undefined} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Start voice command" }));
    await waitFor(() =>
      expect(screen.getByText("Microphone permission was denied.")).toBeTruthy(),
    );
    expect(fake.startVoiceTurn).not.toHaveBeenCalled();
  });

  it("reflects a real active voice state (pushed via onVoiceState) as aria-pressed", async () => {
    const fake = installFakeRyper({});
    render(<Composer onSend={() => undefined} disabled={false} />);
    act(() => fake.__emitVoiceState({ orbStatus: "listening", connection: "connected" }));
    const mic = await screen.findByRole("button", { name: "Stop voice command" });
    expect(mic.getAttribute("aria-pressed")).toBe("true");
  });

  it("stops the real voice turn when the mic button is clicked while active", async () => {
    const fake = installFakeRyper({});
    render(<Composer onSend={() => undefined} disabled={false} />);
    act(() => fake.__emitVoiceState({ orbStatus: "listening", connection: "connected" }));
    const mic = await screen.findByRole("button", { name: "Stop voice command" });
    fireEvent.click(mic);
    expect(fake.stopVoiceTurn).toHaveBeenCalledOnce();
    expect(fake.requestAudioPermission).not.toHaveBeenCalled();
  });

  it("updates its visual state as real voice states are pushed (idle -> thinking)", async () => {
    const fake = installFakeRyper({});
    render(<Composer onSend={() => undefined} disabled={false} />);
    act(() => fake.__emitVoiceState({ orbStatus: "thinking", connection: "connected" }));
    const mic = await screen.findByRole("button", { name: "Stop voice command" });
    expect(mic.className).toContain("composer-mic--thinking");
  });

  it("cleans up its onVoiceState/onAudioStatusChanged listeners on unmount", () => {
    const fake = installFakeRyper({});
    const { unmount } = render(<Composer onSend={() => undefined} disabled={false} />);
    unmount();
    expect(fake.__unsubscribeVoiceState).toHaveBeenCalledOnce();
    expect(fake.__unsubscribeAudioStatus).toHaveBeenCalledOnce();
  });

  it("does not pretend voice is available when the real audio status reports no microphone", async () => {
    const fake = installFakeRyper({});
    render(<Composer onSend={() => undefined} disabled={false} />);
    act(() =>
      fake.__emitAudioStatus({ microphone: "unavailable", speaker: "available" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start voice command" }));
    await waitFor(() => expect(screen.getByText("No microphone is available.")).toBeTruthy());
    expect(fake.requestAudioPermission).not.toHaveBeenCalled();
    expect(fake.startVoiceTurn).not.toHaveBeenCalled();
  });
});
