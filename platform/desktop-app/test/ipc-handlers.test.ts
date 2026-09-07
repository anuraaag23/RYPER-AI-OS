import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `ipc-handlers.ts` imports the real `ipcMain` singleton directly from
 * `electron` (unlike `confirmation-bridge.ts`, which takes it as a
 * constructor parameter) — outside a real Electron process that module
 * has no working `.handle()`, so it must be replaced before
 * `ipc-handlers.ts` is imported. `vi.hoisted()` gives the mock factory
 * access to this map before vitest hoists the `vi.mock` call above the
 * imports below.
 */
const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));

const { bootstrapCore } = await import("../electron/core-bootstrap.js");
const { registerIpcHandlers } = await import("../electron/ipc-handlers.js");
const { IPC_CHANNELS } = await import("../electron/ipc-contract.js");

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler registered for "${channel}"`);
  return handler({}, ...args);
}

describe("registerIpcHandlers — real wiring over a real bootstrapped core", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ryper-ipc-handlers-"));
    handlers.clear();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function setup() {
    const core = await bootstrapCore(
      {
        conversationsFile: join(dir, "conversations.json"),
        settingsFile: join(dir, "settings.json"),
        modelCacheDir: join(dir, "models"),
      },
      () => undefined,
      async () => true,
    );
    registerIpcHandlers({
      core,
      getSettingsWindows: () => [],
      openSettingsWindow: () => undefined,
      startVoiceTurn: async () => undefined,
      stopVoiceTurn: async () => undefined,
    });
    return core;
  }

  it("listConversations/createConversation are real — a created conversation actually appears in the list", async () => {
    await setup();
    const created = (await invoke(IPC_CHANNELS.createConversation, "Test")) as { id: string };
    const list = (await invoke(IPC_CHANNELS.listConversations)) as { id: string }[];
    expect(list.some((c) => c.id === created.id)).toBe(true);
  });

  it("sendMessage drives a real end-to-end turn and persists the real assistant reply", async () => {
    const core = await setup();
    const conversation = await core.conversations.create();
    const response = (await invoke(IPC_CHANNELS.sendMessage, {
      conversationId: conversation.id,
      content: "Hello there",
    })) as { content: string; message: { role: string; content: string } };

    expect(response.content.length).toBeGreaterThan(0);
    expect(response.message.role).toBe("assistant");
    const messages = await core.conversations.listMessages(conversation.id);
    expect(messages.some((m) => m.role === "assistant" && m.content === response.content)).toBe(
      true,
    );
  });

  it("getCurrentReference strips the internal timestamp before it ever reaches the renderer", async () => {
    const core = await setup();
    core.voice.contextTracker.set({ type: "file", path: "C:/notes.txt", source: "open_file" });

    const payload = (await invoke(IPC_CHANNELS.getCurrentReference)) as Record<string, unknown>;
    expect(payload).toMatchObject({ type: "file", path: "C:/notes.txt" });
    expect(payload).not.toHaveProperty("timestamp");
  });

  it("getCurrentReference returns undefined honestly when nothing has been set", async () => {
    await setup();
    const payload = await invoke(IPC_CHANNELS.getCurrentReference);
    expect(payload).toBeUndefined();
  });

  it("cancelTurn on an unknown/already-finished turnId is a real no-op, not an error", async () => {
    await setup();
    await expect(invoke(IPC_CHANNELS.cancelTurn, "no-such-turn")).resolves.toBeUndefined();
  });

  it("getAudioStatus returns a real, honestly-degraded status when no audio hardware is present in this sandbox", async () => {
    await setup();
    const status = (await invoke(IPC_CHANNELS.getAudioStatus)) as {
      microphone: string;
      speaker: string;
    };
    expect(typeof status.microphone).toBe("string");
    expect(typeof status.speaker).toBe("string");
  });

  it("selectAudioDevice honestly rejects an unknown device id rather than silently accepting it", async () => {
    await setup();
    await expect(invoke(IPC_CHANNELS.selectAudioDevice, "speaker", "some-id")).rejects.toThrow(
      /no speaker device/,
    );
  });

  it("deleteMessage actually removes the message from the real store", async () => {
    const core = await setup();
    const conversation = await core.conversations.create();
    const message = await core.conversations.appendMessage(conversation.id, "user", "hi");
    await invoke(IPC_CHANNELS.deleteMessage, conversation.id, message.id);
    const messages = await core.conversations.listMessages(conversation.id);
    expect(messages.some((m) => m.id === message.id)).toBe(false);
  });

  it("getAIStatus returns a friendly, transparent AI status payload (P1-1)", async () => {
    await setup();
    const status = (await invoke(IPC_CHANNELS.getAIStatus)) as {
      mode: string;
      label: string;
      ready: boolean;
    };
    expect(["local", "cloud", "heuristic"]).toContain(status.mode);
    expect(typeof status.label).toBe("string");
    expect(status.label.length).toBeGreaterThan(0);
    expect(status.ready).toBe(true);
    // Verifies no raw technical strings are leaked
    expect(status.label).not.toContain("8090");
    expect(status.label).not.toContain("llama-cpp-local");
    expect(status.label).not.toContain("localhost");
  });

  it("sendMessage broadcasts turnProgress events to chat windows", async () => {
    const progressEvents: unknown[] = [];
    const fakeWebContents = {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        if (channel === IPC_CHANNELS.turnProgress) {
          progressEvents.push(payload);
        }
      },
    };

    const core = await bootstrapCore(
      {
        conversationsFile: join(dir, "conversations.json"),
        settingsFile: join(dir, "settings.json"),
        modelCacheDir: join(dir, "models"),
      },
      () => undefined,
      async () => true,
    );
    registerIpcHandlers({
      core,
      getSettingsWindows: () => [],
      getChatWindows: () => [fakeWebContents as any],
      openSettingsWindow: () => undefined,
      startVoiceTurn: async () => undefined,
      stopVoiceTurn: async () => undefined,
    });

    const conversation = await core.conversations.create();
    await invoke(IPC_CHANNELS.sendMessage, {
      conversationId: conversation.id,
      content: "hi",
    });

    expect(progressEvents.length).toBeGreaterThan(0);
    expect((progressEvents[0] as any).stage).toBe("thinking");
    expect((progressEvents[0] as any).label).toBe("Thinking…");
  });
});
