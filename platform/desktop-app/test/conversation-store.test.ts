import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationNotFoundError, ConversationStore } from "../electron/conversation-store.js";

describe("ConversationStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ryper-conversations-"));
    filePath = join(dir, "conversations.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("starts empty when no file exists yet", async () => {
    const store = new ConversationStore(filePath);
    await expect(store.list()).resolves.toEqual([]);
  });

  it("creates a conversation and lists it back", async () => {
    const store = new ConversationStore(filePath);
    const created = await store.create("Trip planning");
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: created.id,
      title: "Trip planning",
      archived: false,
      pinned: false,
    });
  });

  it("defaults to a title when none is given", async () => {
    const store = new ConversationStore(filePath);
    const created = await store.create();
    expect(created.title).toBe("New conversation");
  });

  it("renames a conversation and bumps updatedAt", async () => {
    const store = new ConversationStore(filePath);
    const created = await store.create("Old title");
    await new Promise((r) => setTimeout(r, 2));
    await store.rename(created.id, "New title");
    const [renamed] = await store.list();
    expect(renamed?.title).toBe("New title");
    expect(new Date(renamed!.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
  });

  it("archives and unarchives a conversation", async () => {
    const store = new ConversationStore(filePath);
    const created = await store.create();
    await store.setArchived(created.id, true);
    let [record] = await store.list();
    expect(record?.archived).toBe(true);
    await store.setArchived(created.id, false);
    [record] = await store.list();
    expect(record?.archived).toBe(false);
  });

  it("deletes a conversation", async () => {
    const store = new ConversationStore(filePath);
    const created = await store.create();
    await store.delete(created.id);
    await expect(store.list()).resolves.toEqual([]);
  });

  it("throws ConversationNotFoundError for operations on a missing conversation", async () => {
    const store = new ConversationStore(filePath);
    await expect(store.rename("nope", "x")).rejects.toThrow(ConversationNotFoundError);
    await expect(store.delete("nope")).rejects.toThrow(ConversationNotFoundError);
    await expect(store.listMessages("nope")).rejects.toThrow(ConversationNotFoundError);
  });

  it("appends messages in order and lists them back", async () => {
    const store = new ConversationStore(filePath);
    const created = await store.create();
    const first = await store.appendMessage(created.id, "user", "Hello");
    const second = await store.appendMessage(created.id, "assistant", "Hi there", "local");
    const messages = await store.listMessages(created.id);
    expect(messages.map((m) => m.id)).toEqual([first.id, second.id]);
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: "Hi there",
      routingTarget: "local",
    });
  });

  it("deletes a single message without affecting others", async () => {
    const store = new ConversationStore(filePath);
    const created = await store.create();
    const first = await store.appendMessage(created.id, "user", "one");
    const second = await store.appendMessage(created.id, "user", "two");
    await store.deleteMessage(created.id, first.id);
    const messages = await store.listMessages(created.id);
    expect(messages.map((m) => m.id)).toEqual([second.id]);
  });

  it("persists across store instances (real file-backed durability)", async () => {
    const store = new ConversationStore(filePath);
    const created = await store.create("Persisted");
    await store.appendMessage(created.id, "user", "does this survive?");

    const reopened = new ConversationStore(filePath);
    const list = await reopened.list();
    expect(list).toHaveLength(1);
    const messages = await reopened.listMessages(created.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("does this survive?");
  });

  it("sorts list() by most recently updated first", async () => {
    const store = new ConversationStore(filePath);
    const first = await store.create("First");
    await new Promise((r) => setTimeout(r, 2));
    await store.create("Second");
    const list = await store.list();
    expect(list[0]?.title).toBe("Second");
    expect(list[1]?.id).toBe(first.id);
  });

  it("getOrCreateByTitle creates once and reuses the same conversation on later calls", async () => {
    const store = new ConversationStore(filePath);
    const first = await store.getOrCreateByTitle("Voice");
    const second = await store.getOrCreateByTitle("Voice");
    expect(second.id).toBe(first.id);
    const list = await store.list();
    expect(list.filter((c) => c.title === "Voice")).toHaveLength(1);
  });

  it("getOrCreateByTitle creates a fresh conversation if the matching one was archived", async () => {
    const store = new ConversationStore(filePath);
    const original = await store.getOrCreateByTitle("Voice");
    await store.setArchived(original.id, true);
    const replacement = await store.getOrCreateByTitle("Voice");
    expect(replacement.id).not.toBe(original.id);
  });

  it("appendMessage persists toolActivity and cancelled only when actually present", async () => {
    const store = new ConversationStore(filePath);
    const created = await store.create();
    const toolActivity = [
      {
        toolCallId: "call-1",
        name: "open_file",
        argsSummary: '{"path":"C:/notes.txt"}',
        ok: true,
        resultSummary: "Opened C:/notes.txt",
      },
    ];
    const withActivity = await store.appendMessage(
      created.id,
      "assistant",
      "Opened it.",
      undefined,
      toolActivity,
    );
    expect(withActivity.toolActivity).toEqual(toolActivity);
    expect(withActivity.cancelled).toBeUndefined();

    const cancelled = await store.appendMessage(
      created.id,
      "assistant",
      "Cancelled.",
      undefined,
      [],
      true,
    );
    expect(cancelled.toolActivity).toBeUndefined();
    expect(cancelled.cancelled).toBe(true);
  });
});
