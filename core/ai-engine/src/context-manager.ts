import {
  ShortTermMemory,
  estimateTokens,
  type LongTermMemory,
  type ConversationTurn,
} from "@ryper/memory";
import type { VectorStore } from "@ryper/rag";
import type { ChatMessage } from "./types.js";

export interface GatheredContext {
  readonly retrievedDocuments: readonly string[];
  readonly retrievedMemories: readonly string[];
  readonly history: readonly ConversationTurn[];
}

export interface ContextManagerOptions {
  readonly tokenBudget?: number;
  readonly ragLimit?: number;
  readonly memoryLimit?: number;
}

/**
 * Owns one conversation's working memory: sliding-window history (via
 * `@ryper/memory`'s `ShortTermMemory`, which this class does not
 * reimplement), retrieval hooks into the document vector store and
 * long-term memory, and a small non-persistent scratch space ("temporary
 * memory") for values that matter only for this session (e.g. a
 * multi-step tool plan) and are intentionally never written back to
 * long-term storage.
 */
export class ContextManager {
  private readonly shortTerm: ShortTermMemory;
  private readonly scratch = new Map<string, unknown>();

  constructor(
    private readonly longTerm: LongTermMemory,
    private readonly vectorStore: VectorStore | undefined,
    options: ContextManagerOptions = {},
  ) {
    this.shortTerm = new ShortTermMemory(options.tokenBudget ?? 4000);
    this.ragLimit = options.ragLimit ?? 3;
    this.memoryLimit = options.memoryLimit ?? 3;
  }

  private readonly ragLimit: number;
  private readonly memoryLimit: number;

  recordUserTurn(content: string): void {
    this.shortTerm.push({ role: "user", content, tokenEstimate: estimateTokens(content) });
  }

  recordAssistantTurn(content: string): void {
    this.shortTerm.push({ role: "assistant", content, tokenEstimate: estimateTokens(content) });
  }

  recordToolTurn(content: string): void {
    this.shortTerm.push({ role: "tool", content, tokenEstimate: estimateTokens(content) });
  }

  async gather(query: string): Promise<GatheredContext> {
    const retrievedDocuments = this.vectorStore
      ? (await this.vectorStore.search(query, this.ragLimit)).map((chunk) => chunk.text)
      : [];
    const retrievedMemories = this.longTerm
      .search(query, { limit: this.memoryLimit })
      .map((item) => item.content);

    return { retrievedDocuments, retrievedMemories, history: this.shortTerm.getTurns() };
  }

  /** Sliding-window compression, delegated to `ShortTermMemory`'s policy; `summarize` may call any provider. */
  compress(summarize: (turns: readonly ConversationTurn[]) => string): void {
    this.shortTerm.compress(summarize);
  }

  toChatMessages(history: readonly ConversationTurn[]): ChatMessage[] {
    return history.map((turn) => ({ role: turn.role, content: turn.content }));
  }

  setScratch(key: string, value: unknown): void {
    this.scratch.set(key, value);
  }

  getScratch<T = unknown>(key: string): T | undefined {
    return this.scratch.get(key) as T | undefined;
  }

  clearScratch(): void {
    this.scratch.clear();
  }

  getShortTermMemory(): ShortTermMemory {
    return this.shortTerm;
  }
}
