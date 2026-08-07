import type { ChatMessage } from "./types.js";
import type { GatheredContext } from "./context-manager.js";
import type { TokenBudgetManager } from "./token-budget.js";

export interface PromptBuilderOptions {
  readonly systemPrompt: string;
}

/**
 * Turns a `GatheredContext` plus the new user message into the exact
 * `ChatMessage[]` sent to a provider. Retrieved context is folded into a
 * single synthetic system-adjacent message rather than spliced into
 * history, so providers that reorder/drop messages under token pressure
 * can't silently separate a citation from the turn it supports.
 */
export class PromptBuilder {
  constructor(private readonly options: PromptBuilderOptions) {}

  build(
    context: GatheredContext,
    userMessage: string,
    modelId: string,
    budget?: TokenBudgetManager,
  ): ChatMessage[] {
    const messages: ChatMessage[] = [{ role: "system", content: this.options.systemPrompt }];

    if (context.retrievedDocuments.length > 0 || context.retrievedMemories.length > 0) {
      const sections: string[] = [];
      if (context.retrievedMemories.length > 0) {
        sections.push(`Known about the user:\n${context.retrievedMemories.join("\n")}`);
      }
      if (context.retrievedDocuments.length > 0) {
        sections.push(`Relevant document excerpts:\n${context.retrievedDocuments.join("\n---\n")}`);
      }
      messages.push({ role: "system", content: sections.join("\n\n") });
    }

    for (const turn of context.history) {
      messages.push({ role: turn.role, content: turn.content });
    }

    messages.push({ role: "user", content: userMessage });

    if (budget && budget.wouldExceed(modelId, messages)) {
      return this.truncateOldestHistory(messages, modelId, budget);
    }
    return messages;
  }

  /** Last-resort trim if compression hasn't already brought history under budget: drop oldest history turns first. */
  private truncateOldestHistory(
    messages: ChatMessage[],
    modelId: string,
    budget: TokenBudgetManager,
  ): ChatMessage[] {
    const result = [...messages];
    // Index 0 is system, index 1 may be the retrieved-context system message — never drop those or the final user turn.
    let cursor = result[1]?.role === "system" ? 2 : 1;
    while (cursor < result.length - 1 && budget.wouldExceed(modelId, result)) {
      result.splice(cursor, 1);
    }
    return result;
  }
}

export function createPromptBuilder(options: PromptBuilderOptions): PromptBuilder {
  return new PromptBuilder(options);
}
