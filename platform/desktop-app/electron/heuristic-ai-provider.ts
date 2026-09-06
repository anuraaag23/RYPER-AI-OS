import { createLogger } from "@ryper/logging";
import { IntentDetector, DEFAULT_INTENT_PATTERNS } from "@ryper/voice-engine";
import type { AIProvider, ChatMessage, ProviderChatRequest, StreamEvent } from "@ryper/ai-engine";
import { DESKTOP_INTENT_PATTERNS } from "./voice-commands.js";

const log = createLogger("desktop-app:heuristic-ai-provider");

/**
 * **Not a language model.** `AIOrchestrator` requires an `AIProvider` to
 * decide, per turn, whether to reply in text or call a tool — no
 * `AIProvider` implementation (local or cloud) exists anywhere in this
 * repository, the same honest gap `@ryper/local-runtime` and
 * `ReferenceVoiceRuntimeProvider` (Phase 13) already document. This
 * class is a deterministic, pattern-matched stand-in so the real
 * `AIOrchestrator`/`ToolRegistry` multi-round tool-execution loop can
 * run and be tested end-to-end today — see `docs/adr/0016` for the full
 * reasoning and its explicit limitations.
 *
 * It reuses `@ryper/voice-engine`'s `IntentDetector` and the exact same
 * pattern sets `VoiceCommandRouter` already matches against
 * (`DEFAULT_INTENT_PATTERNS` + `DESKTOP_INTENT_PATTERNS`) — not a second,
 * divergent set of patterns.
 *
 * Multi-step decomposition: splits the user's message on connective
 * words/punctuation ("then", "and then", ","), attempts an intent match
 * against each segment, and emits **one tool call per turn** — the
 * orchestrator's own loop re-invokes this provider with the tool's
 * result appended, at which point the next segment is attempted. This
 * is naive compared to real LLM planning (see the ADR's tradeoffs
 * section) but genuinely exercises multi-round tool execution with
 * real, sequenced, observable results.
 */
export class HeuristicToolCallingProvider implements AIProvider {
  readonly id = "heuristic-pattern-matcher";
  readonly kind = "local" as const;

  private readonly intentDetector: IntentDetector;

  constructor(private readonly toolNames: ReadonlySet<string>) {
    this.intentDetector = new IntentDetector([
      ...DEFAULT_INTENT_PATTERNS,
      ...DESKTOP_INTENT_PATTERNS,
    ]);
  }

  private splitSteps(text: string): string[] {
    return text
      .split(/\b(?:then|and then|aur|aur fir|fir|uske baad)\b|,/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /** Which steps in this message the tool registry has already handled, based on prior `role: "tool"` messages in history. */
  private countCompletedToolCalls(messages: readonly ChatMessage[]): number {
    return messages.filter((m) => m.role === "tool").length;
  }

  /**
   * `IntentDetector.slots` are always regex-captured strings — but a real
   * LLM asked to produce arguments matching a `ToolSpec` whose schema
   * declares `type: "number"` emits an actual JSON number, not a numeric
   * string. Coercing here keeps this stand-in's output shaped the way
   * its real replacement's output is shaped (and the way
   * `ToolRegistry.invoke()`'s schema validation, Phase 13.9, correctly
   * expects), rather than requiring every tool's `execute()` to
   * loosely re-coerce string input itself.
   */
  private coerceNumericSlots(
    slots: Readonly<Record<string, string>>,
  ): Record<string, string | number> {
    const coerced: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(slots)) {
      const asNumber = Number(value);
      coerced[key] = value.trim() !== "" && !Number.isNaN(asNumber) ? asNumber : value;
    }
    return coerced;
  }

  async *streamChat(request: ProviderChatRequest): AsyncIterable<StreamEvent> {
    if (request.signal?.aborted) {
      yield { type: "error", message: "request was cancelled before it started" };
      yield { type: "done", finishReason: "error" };
      return;
    }

    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) {
      yield { type: "text_delta", delta: "I didn't catch a request to respond to." };
      yield { type: "done", finishReason: "stop" };
      return;
    }

    const steps = this.splitSteps(lastUser.content);
    const completed = this.countCompletedToolCalls(request.messages);

    if (completed < steps.length) {
      const step = steps[completed]!;
      const match = this.intentDetector.detect(step);
      if (match && this.toolNames.has(match.intent)) {
        log.info("heuristic provider emitting tool call", {
          intent: match.intent,
          step: completed + 1,
        });
        yield {
          type: "tool_call",
          toolCall: {
            id: `call-${Date.now()}-${completed}`,
            name: match.intent,
            arguments: this.coerceNumericSlots(match.slots),
          },
        };
        yield { type: "done", finishReason: "tool_calls" };
        return;
      }
    }

    // No (more) matched steps — either every segment was handled, or nothing matched at all.
    // Summarize using the real tool results already collected this turn, honestly, without
    // fabricating anything beyond what those results actually said.
    const toolResults = request.messages.filter((m) => m.role === "tool");
    const summary =
      toolResults.length > 0
        ? `Done. ${toolResults.map((m) => m.content).join(" ")}`
        : `I don't have a pattern-matched way to handle "${lastUser.content}" yet — this fallback isn't a language model, so it can only act on requests matching a known command pattern.`;

    for (const chunk of summary.split(" ")) {
      yield { type: "text_delta", delta: `${chunk} ` };
    }
    yield { type: "done", finishReason: "stop" };
  }
}

export function createHeuristicToolCallingProvider(
  toolNames: ReadonlySet<string>,
): HeuristicToolCallingProvider {
  return new HeuristicToolCallingProvider(toolNames);
}
