import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { createLogger } from "@ryper/logging";
import type {
  ConversationSummary,
  MessageRole,
  StoredMessage,
  ToolActivityEntry,
} from "./ipc-contract.js";

const log = createLogger("desktop-app:conversation-store");

interface ConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  pinned: boolean;
  messages: StoredMessage[];
}

interface StoreFileShape {
  readonly conversations: readonly ConversationRecord[];
}

export class ConversationNotFoundError extends Error {}

/**
 * Real CRUD + persistence for conversations and their message history —
 * the desktop shell's own state (list, rename, archive, delete a
 * conversation; append/delete a message). This is genuinely new code,
 * not a duplicate of `@ryper/conversation`'s `ConversationEngine`:
 * `ConversationEngine` orchestrates a single turn (memory retrieval,
 * routing, generation) and holds only in-process short-term memory —
 * nothing in Core persists a *list* of conversations or their full
 * message history across app restarts, which a desktop chat UI needs.
 * Every `sendMessage` call still goes through the real
 * `ConversationEngine` (see `core-bootstrap.ts`); this class only
 * stores the resulting turns.
 */
export class ConversationStore {
  private conversations: ConversationRecord[] = [];
  private loaded = false;

  constructor(private readonly filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as StoreFileShape;
      this.conversations = Array.isArray(parsed.conversations) ? [...parsed.conversations] : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("conversation store unreadable, backing up and starting empty", { error: String(err) });
        try {
          const bakPath = `${this.filePath}.bak-${Date.now()}`;
          await copyFile(this.filePath, bakPath);
          log.info("corrupted conversation store preserved", { bakPath });
        } catch {
          // preserve failure ignored
        }
      }
      this.conversations = [];
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const payload: StoreFileShape = { conversations: this.conversations };
    const tmpPath = `${this.filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
    await rename(tmpPath, this.filePath);
  }

  private summarize(record: ConversationRecord): ConversationSummary {
    const { id, title, createdAt, updatedAt, archived, pinned } = record;
    return { id, title, createdAt, updatedAt, archived, pinned };
  }

  async list(): Promise<readonly ConversationSummary[]> {
    await this.ensureLoaded();
    return this.conversations
      .slice()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((r) => this.summarize(r));
  }

  async create(title = "New conversation"): Promise<ConversationSummary> {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    const record: ConversationRecord = {
      id: randomUUID(),
      title,
      createdAt: now,
      updatedAt: now,
      archived: false,
      pinned: false,
      messages: [],
    };
    this.conversations.push(record);
    await this.persist();
    log.info("conversation created", { id: record.id });
    return this.summarize(record);
  }

  /**
   * Finds the first non-archived conversation with an exact title
   * match, or creates one. Used to give voice turns a real, visible
   * home in the same conversation list/history the text chat window
   * already renders (Tier 1 UI brief section I — "conversation
   * rendering" — previously voice turns were spoken and then
   * discarded: nothing about them ever appeared in the UI). Title
   * match rather than a fixed id keeps this resilient to a user
   * renaming/deleting it — a fresh one is created on demand either way.
   */
  async getOrCreateByTitle(title: string): Promise<ConversationSummary> {
    await this.ensureLoaded();
    const existing = this.conversations.find((c) => c.title === title && !c.archived);
    if (existing) return this.summarize(existing);
    return this.create(title);
  }

  private async requireConversation(id: string): Promise<ConversationRecord> {
    await this.ensureLoaded();
    const record = this.conversations.find((c) => c.id === id);
    if (!record) throw new ConversationNotFoundError(`no conversation with id "${id}"`);
    return record;
  }

  async rename(id: string, title: string): Promise<void> {
    const record = await this.requireConversation(id);
    record.title = title;
    record.updatedAt = new Date().toISOString();
    await this.persist();
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    const record = await this.requireConversation(id);
    record.archived = archived;
    record.updatedAt = new Date().toISOString();
    await this.persist();
  }

  async delete(id: string): Promise<void> {
    await this.ensureLoaded();
    const before = this.conversations.length;
    this.conversations = this.conversations.filter((c) => c.id !== id);
    if (this.conversations.length === before) {
      throw new ConversationNotFoundError(`no conversation with id "${id}"`);
    }
    await this.persist();
    log.info("conversation deleted", { id });
  }

  async listMessages(conversationId: string): Promise<readonly StoredMessage[]> {
    const record = await this.requireConversation(conversationId);
    return [...record.messages];
  }

  async appendMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    routingTarget?: "local" | "cloud",
    toolActivity?: readonly ToolActivityEntry[],
    cancelled?: boolean,
  ): Promise<StoredMessage> {
    const record = await this.requireConversation(conversationId);
    const message: StoredMessage = {
      id: randomUUID(),
      conversationId,
      role,
      content,
      createdAt: new Date().toISOString(),
      ...(routingTarget ? { routingTarget } : {}),
      ...(toolActivity && toolActivity.length > 0 ? { toolActivity } : {}),
      ...(cancelled ? { cancelled } : {}),
    };
    record.messages.push(message);
    record.updatedAt = message.createdAt;
    await this.persist();
    return message;
  }

  async deleteMessage(conversationId: string, messageId: string): Promise<void> {
    const record = await this.requireConversation(conversationId);
    const before = record.messages.length;
    record.messages = record.messages.filter((m) => m.id !== messageId);
    if (record.messages.length === before) {
      throw new ConversationNotFoundError(`no message with id "${messageId}"`);
    }
    await this.persist();
  }
}

export function createConversationStore(filePath: string): ConversationStore {
  return new ConversationStore(filePath);
}
