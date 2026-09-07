// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../src/components/ChatPanel.js";
import type {
  AudioStatusPayload,
  CurrentReferencePayload,
  SendMessageRequest,
  SendMessageResponse,
  StoredMessage,
  AIStatusPayload,
  TurnProgressPayload,
} from "../electron/ipc-contract.js";

afterEach(cleanup);

// jsdom doesn't implement `Element.scrollTo` — `ChatPanel` calls it in a
// real effect to auto-scroll the message list, which isn't the thing
// under test here, so it's stubbed rather than worked around.
beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
});

/**
 * A minimal, in-memory stand-in for the real `window.ryper` bridge
 * (normally provided by `preload.ts` over real IPC) — just enough of
 * `RyperInvokeApi`/`RyperEventApi` for `ChatPanel` and the hooks it
 * uses (`useMessages`, `useVoiceState`, `useCurrentReference`) to run
 * against, so these can be tested without a real Electron process.
 */
function buildFakeRyper(overrides: {
  messages?: StoredMessage[];
  currentReference?: CurrentReferencePayload | undefined;
  sendMessage?: (request: SendMessageRequest) => Promise<SendMessageResponse>;
  audioStatus?: AudioStatusPayload;
  aiStatus?: AIStatusPayload;
  onTurnProgress?: (handler: (progress: TurnProgressPayload) => void) => () => void;
}) {
  const messages = overrides.messages ?? [];
  return {
    listMessages: vi.fn(async () => messages),
    sendMessage:
      overrides.sendMessage ??
      vi.fn(async (request: SendMessageRequest): Promise<SendMessageResponse> => ({
        content: "ok",
        retrievedContext: [],
        message: {
          id: "reply-1",
          conversationId: request.conversationId,
          role: "assistant",
          content: "ok",
          createdAt: new Date().toISOString(),
        },
      })),
    deleteMessage: vi.fn(async () => undefined),
    regenerateMessage: vi.fn(async () => {
      throw new Error("not used in these tests");
    }),
    cancelTurn: vi.fn(async () => undefined),
    getCurrentReference: vi.fn(async () => overrides.currentReference),
    startVoiceTurn: vi.fn(async () => undefined),
    stopVoiceTurn: vi.fn(async () => undefined),
    onVoiceState: vi.fn(() => () => undefined),
    onConversationUpdated: vi.fn(() => () => undefined),
    getAudioStatus: vi.fn(
      async (): Promise<AudioStatusPayload> =>
        overrides.audioStatus ?? { microphone: "available", speaker: "available" },
    ),
    requestAudioPermission: vi.fn(async () => true),
    onAudioStatusChanged: vi.fn(() => () => undefined),
    getAIStatus: vi.fn(
      async (): Promise<AIStatusPayload> =>
        overrides.aiStatus ?? { mode: "local", label: "Local AI • Qwen3-8B", ready: true },
    ),
    onTurnProgress: overrides.onTurnProgress ?? vi.fn(() => () => undefined),
  };
}

function installFakeRyper(overrides: Parameters<typeof buildFakeRyper>[0] = {}) {
  const fake = buildFakeRyper(overrides);
  Object.defineProperty(window, "ryper", { value: fake, writable: true, configurable: true });
  return fake;
}

describe("ChatPanel", () => {
  beforeEach(() => {
    installFakeRyper({});
  });

  it("shows the welcome hero, suggestion chips, and persistent composer when no conversation is selected (P0-2)", () => {
    render(<ChatPanel conversationId={undefined} />);
    expect(screen.getByText("Hi, I'm RYPER.")).toBeTruthy();
    expect(screen.getByText("Check my battery")).toBeTruthy();
    expect(screen.getByText("Open Notepad")).toBeTruthy();
    expect(screen.getByText("What can you do?")).toBeTruthy();
    expect(screen.getByPlaceholderText("Message Ryper…")).toBeTruthy();
  });

  it("loads and renders existing messages for the selected conversation", async () => {
    installFakeRyper({
      messages: [
        {
          id: "m1",
          conversationId: "c1",
          role: "user",
          content: "hi",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    render(<ChatPanel conversationId="c1" />);
    await waitFor(() => expect(screen.getByText("hi")).toBeTruthy());
  });

  it("renders the real context-reference chip only when one exists, honestly labelled", async () => {
    installFakeRyper({
      currentReference: { type: "file", path: "C:/notes.txt", source: "open_file" },
    });
    render(<ChatPanel conversationId="c1" />);
    await waitFor(() =>
      expect(screen.getByText("Referring to this file: C:/notes.txt")).toBeTruthy(),
    );
  });

  it("renders no context-reference chip when there is none", async () => {
    installFakeRyper({ currentReference: undefined });
    render(<ChatPanel conversationId="c1" />);
    await waitFor(() => expect(screen.getByPlaceholderText("Message Ryper…")).toBeTruthy());
    expect(screen.queryByText(/Referring to/)).toBeNull();
  });

  it("shows the transparent, friendly AI status indicator in the header (P1-1)", async () => {
    installFakeRyper({
      aiStatus: { mode: "local", label: "Local AI • Qwen3-8B", ready: true },
    });
    render(<ChatPanel conversationId="c1" />);
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "AI Status: Local AI • Qwen3-8B" })).toBeTruthy(),
    );
    expect(screen.getByText("Local AI • Qwen3-8B")).toBeTruthy();
  });

  it("shows a sanitized friendly error banner with a safe Retry button on failure (P1-2)", async () => {
    let attempts = 0;
    const fake = installFakeRyper({
      sendMessage: vi.fn(async (request: SendMessageRequest) => {
        attempts++;
        if (attempts === 1) {
          throw new Error("ProviderError: connect ECONNREFUSED 127.0.0.1:8090");
        }
        return {
          content: "success on retry",
          retrievedContext: [],
          message: {
            id: "reply-retry",
            conversationId: request.conversationId,
            role: "assistant",
            content: "success on retry",
            createdAt: new Date().toISOString(),
          },
        };
      }),
    });
    render(<ChatPanel conversationId="c1" />);
    const textarea = await screen.findByPlaceholderText("Message Ryper…");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() =>
      expect(
        screen.getByText(
          "RYPER couldn't complete that request. The local AI isn't responding right now.",
        ),
      ).toBeTruthy(),
    );
    // Never leaks raw technical string
    expect(screen.queryByText(/ECONNREFUSED/)).toBeNull();
    expect(screen.queryByText(/8090/)).toBeNull();

    // Verify Retry button is visible and works
    const retryBtn = screen.getByRole("button", { name: "Retry request" });
    expect(retryBtn).toBeTruthy();
    fireEvent.click(retryBtn);

    await waitFor(() => expect(fake.sendMessage).toHaveBeenCalledTimes(2));

    // After success, error banner is gone
    await waitFor(() =>
      expect(
        screen.queryByText(
          "RYPER couldn't complete that request. The local AI isn't responding right now.",
        ),
      ).toBeNull(),
    );
  });

  it("shows a Cancel control while a turn is in flight, wired to the real cancelTurn IPC call", async () => {
    let resolveSend: ((value: SendMessageResponse) => void) | undefined;
    const fake = installFakeRyper({
      sendMessage: vi.fn(
        () =>
          new Promise<SendMessageResponse>((resolve) => {
            resolveSend = resolve;
          }),
      ),
    });
    render(<ChatPanel conversationId="c1" />);
    const textarea = await screen.findByPlaceholderText("Message Ryper…");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => expect(screen.getByText("Cancel")).toBeTruthy());
    fireEvent.click(screen.getByText("Cancel"));
    expect(fake.cancelTurn).toHaveBeenCalledOnce();

    // Let the pending send settle so the test doesn't leak a dangling promise.
    await act(async () => {
      resolveSend?.({
        content: "ok",
        retrievedContext: [],
        message: {
          id: "m2",
          conversationId: "c1",
          role: "assistant",
          content: "ok",
          createdAt: new Date().toISOString(),
        },
      });
    });
  });

  it("clicking a suggestion chip sends the prompt through the normal pipeline", async () => {
    const fake = installFakeRyper({ messages: [] });
    render(<ChatPanel conversationId="c1" />);
    const chip = screen.getByText("Check my battery");
    fireEvent.click(chip);
    await waitFor(() => expect(fake.sendMessage).toHaveBeenCalledWith({
      conversationId: "c1",
      content: "Check my battery",
      turnId: expect.any(String),
    }));
  });

  it("invokes onStartConversation when submitting with no active conversation", async () => {
    const onStart = vi.fn();
    render(<ChatPanel conversationId={undefined} onStartConversation={onStart} />);
    const chip = screen.getByText("Open Notepad");
    fireEvent.click(chip);
    expect(onStart).toHaveBeenCalledWith("Open Notepad");
  });
});
