import type { EventBus } from "@ryper/event-bus";
import type { ModelRouter, DeviceState, RoutingHint } from "@ryper/model-router";
import {
  ShortTermMemory,
  estimateTokens,
  type LongTermMemory,
  type ConversationTurn,
} from "@ryper/memory";
import type { VectorStore } from "@ryper/rag";
import { createLogger } from "@ryper/logging";

const log = createLogger("conversation");

export interface SendMessageOptions {
  readonly routingHint?: RoutingHint;
  readonly device: DeviceState;
  readonly requiresWebSearch?: boolean;
  readonly requiresAdvancedReasoning?: boolean;
  readonly privacySensitive?: boolean;
}

export interface AssistantReply {
  readonly content: string;
  readonly routingTarget: "local" | "cloud";
  readonly retrievedContext: readonly string[];
}

/**
 * Orchestrates a single conversation: retrieves relevant memory/RAG context,
 * asks the Model Router where to run, generates a reply, and writes the turn
 * back into short-term memory (and, via the event bus, into long-term
 * memory consolidation). This class contains no model-specific logic — that
 * lives behind the registered ModelProvider.
 */
export class ConversationEngine {
  private readonly shortTerm: ShortTermMemory;

  constructor(
    private readonly router: ModelRouter,
    private readonly longTerm: LongTermMemory,
    private readonly vectorStore: VectorStore | undefined,
    private readonly eventBus: EventBus,
    tokenBudget = 4000,
  ) {
    this.shortTerm = new ShortTermMemory(tokenBudget);
  }

  async sendMessage(
    conversationId: string,
    content: string,
    options: SendMessageOptions,
  ): Promise<AssistantReply> {
    this.shortTerm.push({ role: "user", content, tokenEstimate: estimateTokens(content) });

    const retrievedContext: string[] = [];
    if (this.vectorStore) {
      const hits = await this.vectorStore.search(content, 3);
      retrievedContext.push(...hits.map((h) => h.text));
    }
    for (const memory of this.longTerm.search(content, { limit: 3 })) {
      retrievedContext.push(memory.content);
    }

    const { decision, output } = await this.router.route(
      {
        hint: options.routingHint ?? "auto",
        device: options.device,
        requiresWebSearch: options.requiresWebSearch,
        requiresAdvancedReasoning: options.requiresAdvancedReasoning,
        privacySensitive: options.privacySensitive,
      },
      this.buildPrompt(content, retrievedContext),
    );

    const reply: ConversationTurn = {
      role: "assistant",
      content: output,
      tokenEstimate: estimateTokens(output),
    };
    this.shortTerm.push(reply);

    await this.eventBus.emit(
      "conversation.turn_completed",
      { conversationId, routingTarget: decision.target },
      "conversation",
    );
    log.info("turn completed", { conversationId, routingTarget: decision.target });

    return { content: output, routingTarget: decision.target, retrievedContext };
  }

  getShortTermMemory(): ShortTermMemory {
    return this.shortTerm;
  }

  private buildPrompt(content: string, context: readonly string[]): string {
    if (context.length === 0) return content;
    return `Context:\n${context.join("\n---\n")}\n\nUser: ${content}`;
  }
}
