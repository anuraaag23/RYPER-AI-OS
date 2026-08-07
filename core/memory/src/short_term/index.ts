export interface ConversationTurn {
  readonly role: "user" | "assistant" | "tool";
  readonly content: string;
  readonly tokenEstimate: number;
}

export interface CompressionResult {
  readonly turns: readonly ConversationTurn[];
  readonly summarizedCount: number;
}

/** Very rough token estimate (chars / 4) — good enough for budget checks, not billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Holds the active conversation window and compresses the oldest turns into
 * a single summary turn once the token budget is exceeded, rather than
 * silently truncating history.
 */
export class ShortTermMemory {
  private turns: ConversationTurn[] = [];

  constructor(private readonly tokenBudget: number) {}

  push(turn: ConversationTurn): void {
    this.turns.push(turn);
  }

  currentTokens(): number {
    return this.turns.reduce((sum, t) => sum + t.tokenEstimate, 0);
  }

  getTurns(): readonly ConversationTurn[] {
    return this.turns;
  }

  /**
   * Collapses the oldest turns into one summary turn until the remaining
   * history fits the budget. `summarize` is supplied by the caller (it may
   * call a local or cloud model); this module owns only the compaction
   * policy, not generation.
   */
  compress(summarize: (turns: readonly ConversationTurn[]) => string): CompressionResult {
    if (this.currentTokens() <= this.tokenBudget || this.turns.length <= 1) {
      return { turns: this.turns, summarizedCount: 0 };
    }

    const keepFromEnd = Math.max(1, Math.floor(this.turns.length / 2));
    const toSummarize = this.turns.slice(0, this.turns.length - keepFromEnd);
    const toKeep = this.turns.slice(this.turns.length - keepFromEnd);

    const summaryText = summarize(toSummarize);
    const summaryTurn: ConversationTurn = {
      role: "assistant",
      content: `[compressed summary of ${toSummarize.length} earlier turns] ${summaryText}`,
      tokenEstimate: estimateTokens(summaryText),
    };

    this.turns = [summaryTurn, ...toKeep];
    return { turns: this.turns, summarizedCount: toSummarize.length };
  }
}
