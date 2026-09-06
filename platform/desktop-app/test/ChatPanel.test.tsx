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
    // Composer's own microphone control (see `Composer.tsx`) now also
    // calls these directly, independent of `ChatPanel`'s own
    // `useVoiceState`/`onOrbPress` — same real `window.ryper` surface,
    // just a second real entry point into it.
    getAudioStatus: vi.fn(
      async (): Promise<AudioStatusPayload> =>
        overrides.audioStatus ?? { microphone: "available", speaker: "available" },
    ),
    requestAudioPermission: vi.fn(async () => true),
    onAudioStatusChanged: vi.fn(() => () => undefined),
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

  it("shows the empty-state prompt when no conversation is selected", () => {
    render(<ChatPanel conversationId={undefined} />);
    expect(screen.getByText("Select or start a conversation to begin.")).toBeTruthy();
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

  it("shows a real, dismissible error banner when a send genuinely fails — no silent failure", async () => {
    const fake = installFakeRyper({
      sendMessage: vi.fn(async () => {
        throw new Error("the AI orchestrator returned an empty response");
      }),
    });
    render(<ChatPanel conversationId="c1" />);
    const textarea = await screen.findByPlaceholderText("Message Ryper…");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() =>
      expect(screen.getByText("the AI orchestrator returned an empty response")).toBeTruthy(),
    );
    expect(fake.sendMessage).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText("Dismiss error"));
    expect(screen.queryByText("the AI orchestrator returned an empty response")).toBeNull();
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
});
