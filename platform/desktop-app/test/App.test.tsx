// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import type {
  AppSettings,
  AudioStatusPayload,
  ConversationSummary,
  StoredMessage,
} from "../electron/ipc-contract.js";

afterEach(cleanup);

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
});

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  voiceEnabled: true,
  launchAtLogin: false,
  pushToTalkShortcut: "CommandOrControl+Shift+Space",
};

const DEFAULT_AUDIO_STATUS: AudioStatusPayload = {
  microphone: "available",
  speaker: "available",
};

function installFakeRyper(options: {
  conversations?: ConversationSummary[];
  messages?: StoredMessage[];
}) {
  let convs = [...(options.conversations ?? [])];
  const createConversation = vi.fn(async (title?: string) => {
    const newConv: ConversationSummary = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title ?? "New conversation",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archived: false,
      pinned: false,
    };
    convs.push(newConv);
    return newConv;
  });

  const fake = {
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
    onSettingsChanged: vi.fn(() => () => undefined),
    getAudioStatus: vi.fn(async () => DEFAULT_AUDIO_STATUS),
    onAudioStatusChanged: vi.fn(() => () => undefined),
    listConversations: vi.fn(async () => [...convs]),
    createConversation,
    renameConversation: vi.fn(async () => undefined),
    archiveConversation: vi.fn(async () => undefined),
    deleteConversation: vi.fn(async () => undefined),
    listMessages: vi.fn(async () => options.messages ?? []),
    sendMessage: vi.fn(async () => ({
      content: "ok",
      retrievedContext: [],
      message: {
        id: "reply-1",
        conversationId: "conv-1",
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
    onStartupDiagnostics: vi.fn(() => () => undefined),
    onConfirmationRequested: vi.fn(() => () => undefined),
    onConversationUpdated: vi.fn(() => () => undefined),
    openSettingsWindow: vi.fn(async () => undefined),
    listPermissions: vi.fn(async () => []),
    resetPermissions: vi.fn(async () => undefined),
  };

  Object.defineProperty(window, "ryper", { value: fake, writable: true, configurable: true });
  return { fake, createConversation };
}

describe("App first-run conversation and composer lifecycle (P0-2)", () => {
  it("automatically creates one default conversation on clean first launch (0 conversations)", async () => {
    const { createConversation } = installFakeRyper({ conversations: [] });

    render(<App />);

    // Waits for settings & conversations to load and create initial conversation
    await waitFor(() => {
      expect(createConversation).toHaveBeenCalledOnce();
    });

    // Composer must be immediately visible and operable
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Message Ryper…")).toBeTruthy();
    });

    // Welcome hero and suggestion chips must be displayed
    expect(screen.getByText("Hi, I'm RYPER.")).toBeTruthy();
    expect(screen.getByText("Check my battery")).toBeTruthy();
    expect(screen.getByText("Open Notepad")).toBeTruthy();
    expect(screen.getByText("What can you do?")).toBeTruthy();
  });

  it("does NOT create a duplicate conversation when conversations already exist", async () => {
    const existing: ConversationSummary = {
      id: "existing-1",
      title: "My Existing Chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archived: false,
      pinned: false,
    };
    const { createConversation } = installFakeRyper({ conversations: [existing] });

    render(<App />);

    // Waits for app to be ready
    await waitFor(() => {
      expect(screen.getByText("My Existing Chat")).toBeTruthy();
    });

    // Verify create was NEVER called
    expect(createConversation).not.toHaveBeenCalled();

    // Composer is immediately visible for the existing conversation
    expect(screen.getByPlaceholderText("Message Ryper…")).toBeTruthy();
  });
});
