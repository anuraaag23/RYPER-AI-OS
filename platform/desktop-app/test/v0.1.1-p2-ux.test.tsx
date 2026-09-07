// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../src/components/ChatPanel.js";
import {
  formatAudioDeviceName,
  formatShortcutForDisplay,
  parseShortcutFromInput,
} from "../src/SettingsApp.js";
import { formatStartupStep } from "../src/components/SplashOverlay.js";
import { formatToolName } from "../src/components/MessageBubble.js";
import { sanitizeUserFacingError } from "../src/lib/user-error-sanitizer.js";
import type {
  AIStatusPayload,
  AudioStatusPayload,
  SendMessageRequest,
  SendMessageResponse,
} from "../electron/ipc-contract.js";

afterEach(cleanup);

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
});

function installFakeRyper(overrides: {
  sendMessage?: (request: SendMessageRequest) => Promise<SendMessageResponse>;
  aiStatus?: AIStatusPayload;
} = {}) {
  const fake = {
    listMessages: vi.fn(async () => []),
    sendMessage:
      overrides.sendMessage ??
      vi.fn(async (req: SendMessageRequest): Promise<SendMessageResponse> => ({
        content: "ok",
        retrievedContext: [],
        message: {
          id: "reply-1",
          conversationId: req.conversationId,
          role: "assistant",
          content: "ok",
          createdAt: new Date().toISOString(),
        },
      })),
    deleteMessage: vi.fn(async () => undefined),
    regenerateMessage: vi.fn(async () => undefined),
    cancelTurn: vi.fn(async () => undefined),
    getCurrentReference: vi.fn(async () => undefined),
    startVoiceTurn: vi.fn(async () => undefined),
    stopVoiceTurn: vi.fn(async () => undefined),
    onVoiceState: vi.fn(() => () => undefined),
    onConversationUpdated: vi.fn(() => () => undefined),
    getAudioStatus: vi.fn(
      async (): Promise<AudioStatusPayload> => ({
        microphone: "available",
        speaker: "available",
      }),
    ),
    requestAudioPermission: vi.fn(async () => true),
    onAudioStatusChanged: vi.fn(() => () => undefined),
    getAIStatus: vi.fn(
      async (): Promise<AIStatusPayload> =>
        overrides.aiStatus ?? { mode: "local", label: "Local AI • Qwen3-8B", ready: true },
    ),
    onTurnProgress: vi.fn(() => () => undefined),
  };
  Object.defineProperty(window, "ryper", { value: fake, writable: true, configurable: true });
  return fake;
}

describe("P2-1 & P2-2: ChatPanel Popover and Long-Wait Communication", () => {
  it("toggles the AI status popover with privacy/offline info on click", async () => {
    installFakeRyper();
    render(<ChatPanel conversationId="c1" />);

    const indicator = await screen.findByRole("status", { name: /Local AI/i });
    expect(indicator).toBeTruthy();
    expect(indicator.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("On-Device AI")).toBeNull();

    // Click to open popover
    fireEvent.click(indicator);
    expect(indicator.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("On-Device & Private:")).toBeTruthy();
    expect(screen.getByText("Works Offline:")).toBeTruthy();
    expect(screen.getByText("First-Turn Startup:")).toBeTruthy();

    // Press Escape to dismiss
    fireEvent.keyDown(document, { key: "Escape" });
    expect(indicator.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("On-Device AI")).toBeNull();
  });

  it("displays long-wait reassurance after 12 seconds in pending state", async () => {
    vi.useFakeTimers();
    let resolveSend: ((val: SendMessageResponse) => void) | undefined;
    installFakeRyper({
      sendMessage: vi.fn(
        () =>
          new Promise<SendMessageResponse>((resolve) => {
            resolveSend = resolve;
          }),
      ),
    });

    render(<ChatPanel conversationId="c1" />);
    const textarea = screen.getByPlaceholderText("Message Ryper…");
    fireEvent.change(textarea, { target: { value: "Complex query" } });
    fireEvent.click(screen.getByText("Send"));

    // Immediately shows pending message
    expect(screen.getByText("Thinking…")).toBeTruthy();
    expect(
      screen.queryByText("Still working — local AI can take a little longer for complex requests."),
    ).toBeNull();

    // Advance 5 seconds - still thinking
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(
      screen.queryByText("Still working — local AI can take a little longer for complex requests."),
    ).toBeNull();

    // Advance past 12 seconds (total 13s)
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(
      screen.getByText("Still working — local AI can take a little longer for complex requests."),
    ).toBeTruthy();

    // Animated pulse and cancel button remain visible
    expect(document.querySelector(".pending-pulse")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();

    // Resolve send to clean up
    await act(async () => {
      resolveSend?.({
        content: "Done",
        retrievedContext: [],
        message: {
          id: "m-done",
          conversationId: "c1",
          role: "assistant",
          content: "Done",
          createdAt: new Date().toISOString(),
        },
      });
    });
    vi.useRealTimers();
  });
});

describe("P2-3: Device and Shortcut Formatting", () => {
  it("formatAudioDeviceName strips raw GUIDs and preserves friendly names", () => {
    expect(
      formatAudioDeviceName("Speakers ({0.0.0.00000000}.{a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d})"),
    ).toBe("Speakers");

    expect(
      formatAudioDeviceName("Microphone Array ({0.0.1.00000000}.{12345678-abcd-ef01-2345-6789abcdef01})"),
    ).toBe("Microphone Array");

    expect(
      formatAudioDeviceName("Headset Earphone {aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}"),
    ).toBe("Headset Earphone");

    expect(
      formatAudioDeviceName("Realtek High Definition Audio"),
    ).toBe("Realtek High Definition Audio");

    expect(formatAudioDeviceName("", "microphone", 0)).toBe("Microphone 1");
    expect(formatAudioDeviceName("", "speaker", 1)).toBe("Speaker 2");
  });

  it("formatShortcutForDisplay formats Electron accelerators into Windows-native text", () => {
    expect(formatShortcutForDisplay("CommandOrControl+Shift+Space")).toBe("Ctrl + Shift + Space");
    expect(formatShortcutForDisplay("Control+Alt+T")).toBe("Ctrl + Alt + T");
    expect(formatShortcutForDisplay("Cmd+Space")).toBe("Ctrl + Space");
  });

  it("parseShortcutFromInput converts user input into Electron accelerator format", () => {
    expect(parseShortcutFromInput("Ctrl + Shift + Space")).toBe("CommandOrControl+Shift+Space");
    expect(parseShortcutFromInput("Ctrl+Space")).toBe("CommandOrControl+Space");
    expect(parseShortcutFromInput("CommandOrControl+Shift+Space")).toBe("CommandOrControl+Shift+Space");
  });

  it("formatToolName turns internal snake_case into human-readable action titles", () => {
    expect(formatToolName("system_run_app")).toBe("Open Application");
    expect(formatToolName("system_power_query")).toBe("Check Power Status");
    expect(formatToolName("system_volume_set")).toBe("Adjust Volume");
    expect(formatToolName("open_url")).toBe("Open Browser");
    expect(formatToolName("system_custom_action")).toBe("Custom Action");
  });
});

describe("P2-6 & P2-7: Error Sanitization and Splash Formatting", () => {
  it("sanitizes system_* tool completed action failures without retry", () => {
    const res1 = sanitizeUserFacingError("action_completed:system_run_app:spawn error");
    expect(res1.message).toBe("The action was performed (opening the application), but RYPER couldn't generate a summary.");
    expect(res1.canRetry).toBe(false);

    const res2 = sanitizeUserFacingError("action_completed:system_power_query:timed out");
    expect(res2.message).toBe("The action was performed (checking battery and power status), but RYPER couldn't generate a summary.");
    expect(res2.canRetry).toBe(false);

    const res3 = sanitizeUserFacingError("action_completed:custom_camera_tool:error");
    expect(res3.message).toBe("The action was performed (custom camera tool), but RYPER couldn't generate a summary.");
    expect(res3.canRetry).toBe(false);
  });

  it("formatStartupStep eliminates developer acronyms from splash screen", () => {
    expect(
      formatStartupStep("voice pipeline (wake word, VAD, STT/TTS, session, commands, memory)"),
    ).toBe("Voice recognition & speech synthesis");

    expect(
      formatStartupStep("core services (event bus, model router, memory, conversation)"),
    ).toBe("Core system services");

    expect(
      formatStartupStep("security & platform capability layer"),
    ).toBe("Security & permissions system");

    expect(
      formatStartupStep("windows platform agent"),
    ).toBe("Windows desktop integration");

    expect(
      formatStartupStep("local AI runtime provisioning & detection"),
    ).toBe("Local AI engine");
  });
});
