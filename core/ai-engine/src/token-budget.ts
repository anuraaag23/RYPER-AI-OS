import { estimateTokens } from "@ryper/memory";
import type { ChatMessage } from "./types.js";

export interface ModelTokenLimits {
  readonly contextWindow: number;
  /** Tokens reserved for the model's own reply so the prompt never fills the entire window. */
  readonly reservedForCompletion: number;
}

/**
 * Central place that decides "does this prompt fit, and how much room is
 * left for a reply" — every other module (PromptBuilder, ContextManager)
 * asks this instead of re-deriving a budget number itself.
 */
export class TokenBudgetManager {
  constructor(private readonly limits: Readonly<Record<string, ModelTokenLimits>>) {}

  limitsFor(modelId: string): ModelTokenLimits {
    const limits = this.limits[modelId];
    if (!limits) {
      throw new Error(`no token limits configured for model "${modelId}"`);
    }
    return limits;
  }

  estimateMessagesTokens(messages: readonly ChatMessage[]): number {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  }

  promptBudget(modelId: string): number {
    const limits = this.limitsFor(modelId);
    return Math.max(0, limits.contextWindow - limits.reservedForCompletion);
  }

  wouldExceed(modelId: string, messages: readonly ChatMessage[]): boolean {
    return this.estimateMessagesTokens(messages) > this.promptBudget(modelId);
  }

  remainingBudget(modelId: string, messages: readonly ChatMessage[]): number {
    return this.promptBudget(modelId) - this.estimateMessagesTokens(messages);
  }
}

export function createTokenBudgetManager(
  limits: Readonly<Record<string, ModelTokenLimits>>,
): TokenBudgetManager {
  return new TokenBudgetManager(limits);
}
