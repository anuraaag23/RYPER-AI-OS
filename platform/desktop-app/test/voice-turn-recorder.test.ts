import { describe, expect, it, vi } from "vitest";
import {
  createVoiceTurnRecorder,
  VOICE_CONVERSATION_TITLE,
} from "../electron/voice-turn-recorder.js";
import type { ToolActivityEntry } from "../electron/ipc-contract.js";

function fakeConversations(overrides: Partial<Record<string, unknown>> = {}) {
  const appended: Array<{
    conversationId: string;
    role: string;
    content: string;
    toolActivity?: readonly ToolActivityEntry[];
  }> = [];
  return {
    appended,
    getOrCreateByTitle: vi.fn(async (title: string) => ({
      id: "voice-conv-1",
      title,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archived: false,
      pinned: false,
      messageCount: 0,
    })),
    appendMessage: vi.fn(
      async (
        conversationId: string,
        role: "user" | "assistant",
        content: string,
        _routingTarget?: "local" | "cloud",
        toolActivity?: readonly ToolActivityEntry[],
      ) => {
        appended.push({ conversationId, role, content, toolActivity });
        return {
          id: `msg-${appended.length}`,
          conversationId,
          role,
          content,
          createdAt: "2026-01-01T00:00:00.000Z",
          toolActivity,
        };
      },
    ),
    ...overrides,
  };
}

describe("createVoiceTurnRecorder", () => {
  it("finds-or-creates the real 'Voice' conversation and appends both sides of the turn in order", async () => {
    const conversations = fakeConversations();
    const onRecorded = vi.fn();
    const record = createVoiceTurnRecorder({ conversations, onRecorded });

    await record("what's the weather", "It's sunny.", []);

    expect(conversations.getOrCreateByTitle).toHaveBeenCalledWith(VOICE_CONVERSATION_TITLE);
    expect(conversations.appended).toEqual([
      {
        conversationId: "voice-conv-1",
        role: "user",
        content: "what's the weather",
        toolActivity: undefined,
      },
      {
        conversationId: "voice-conv-1",
        role: "assistant",
        content: "It's sunny.",
        toolActivity: [],
      },
    ]);
  });

  it("passes real tool activity through to the assistant message", async () => {
    const conversations = fakeConversations();
    const onRecorded = vi.fn();
    const record = createVoiceTurnRecorder({ conversations, onRecorded });
    const toolActivity: ToolActivityEntry[] = [
      {
        toolCallId: "call-1",
        name: "open_file",
        argsSummary: '{"path":"C:/notes.txt"}',
        ok: true,
        resultSummary: "Opened C:/notes.txt",
      },
    ];

    await record("open my notes", "Opened it.", toolActivity);

    expect(conversations.appended[1]?.toolActivity).toEqual(toolActivity);
  });

  it("notifies with the conversation id after a successful persist", async () => {
    const conversations = fakeConversations();
    const onRecorded = vi.fn();
    const record = createVoiceTurnRecorder({ conversations, onRecorded });

    await record("hello", "hi there", []);

    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(onRecorded).toHaveBeenCalledWith("voice-conv-1");
  });

  it("reuses the same conversation across multiple turns (find, not always create)", async () => {
    const conversations = fakeConversations();
    const record = createVoiceTurnRecorder({ conversations, onRecorded: vi.fn() });

    await record("first", "reply one", []);
    await record("second", "reply two", []);

    expect(conversations.getOrCreateByTitle).toHaveBeenCalledTimes(2);
    const ids = new Set(conversations.appended.map((m) => m.conversationId));
    expect(ids.size).toBe(1);
  });

  it("swallows a persistence failure instead of throwing, and never notifies", async () => {
    const conversations = fakeConversations({
      getOrCreateByTitle: vi.fn(async () => {
        throw new Error("disk is full");
      }),
    });
    const onRecorded = vi.fn();
    const record = createVoiceTurnRecorder({ conversations, onRecorded });

    await expect(record("hello", "hi", [])).resolves.toBeUndefined();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it("swallows a mid-write failure (conversation created, second appendMessage fails) without notifying", async () => {
    let calls = 0;
    const conversations = fakeConversations({
      appendMessage: vi.fn(async () => {
        calls += 1;
        if (calls === 2) throw new Error("write failed");
        return {
          id: "msg-1",
          conversationId: "voice-conv-1",
          role: "user",
          content: "x",
          createdAt: "2026-01-01T00:00:00.000Z",
        };
      }),
    });
    const onRecorded = vi.fn();
    const record = createVoiceTurnRecorder({ conversations, onRecorded });

    await expect(record("hello", "hi", [])).resolves.toBeUndefined();
    expect(onRecorded).not.toHaveBeenCalled();
  });
});
