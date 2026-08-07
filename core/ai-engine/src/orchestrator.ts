import { createLogger } from "@ryper/logging";
import type { EventBus } from "@ryper/event-bus";
import type { TelemetryClient } from "@ryper/telemetry";
import type { RoutingHint, DeviceState } from "@ryper/model-router";

import type { AIProvider, ChatMessage, StreamEvent, ToolCallRequest } from "./types.js";
import type { ProviderRegistry } from "./providers/registry.js";
import type { ModelSelectionEngine } from "./model-selection.js";
import type { PromptBuilder } from "./prompt-builder.js";
import type { TokenBudgetManager } from "./token-budget.js";
import type { ToolRegistry } from "./tool-calling/registry.js";
import type { SessionManager } from "./session-manager.js";
import { retryWithBackoff, ProviderError, type RetryOptions } from "./error-recovery.js";
import { withTimeout } from "./streaming.js";

const log = createLogger("ai-engine:orchestrator");

export interface SendMessageOptions {
  readonly routingHint?: RoutingHint;
  readonly device: DeviceState;
  readonly requiresWebSearch?: boolean;
  readonly requiresAdvancedReasoning?: boolean;
  readonly privacySensitive?: boolean;
  readonly preferredProviderId?: string;
  readonly signal?: AbortSignal;
}

export interface AIOrchestratorOptions {
  readonly providerRegistry: ProviderRegistry;
  readonly modelSelection: ModelSelectionEngine;
  readonly promptBuilder: PromptBuilder;
  readonly tokenBudget: TokenBudgetManager;
  readonly toolRegistry: ToolRegistry;
  readonly sessionManager: SessionManager;
  readonly eventBus: EventBus;
  readonly telemetry?: TelemetryClient;
  readonly maxToolRounds?: number;
  readonly streamTimeoutMs?: number;
  readonly retry?: Partial<RetryOptions>;
}

/**
 * The heart of RYPER AI OS. Every future module (voice, documents, browser
 * assistant, automation, mobile/desktop shells) drives a conversational
 * turn through `sendMessage` rather than talking to a provider, the memory
 * system, or the tool registry directly — see the package README for the
 * full integration contract.
 */
export class AIOrchestrator {
  private readonly maxToolRounds: number;
  private readonly streamTimeoutMs: number;
  private readonly retryOptions: RetryOptions;

  constructor(private readonly options: AIOrchestratorOptions) {
    this.maxToolRounds = options.maxToolRounds ?? 5;
    this.streamTimeoutMs = options.streamTimeoutMs ?? 30_000;
    this.retryOptions = {
      maxAttempts: options.retry?.maxAttempts ?? 2,
      initialDelayMs: options.retry?.initialDelayMs ?? 250,
      maxDelayMs: options.retry?.maxDelayMs,
      isRetryable: options.retry?.isRetryable,
      sleep: options.retry?.sleep,
    };
  }

  async *sendMessage(
    sessionId: string,
    userText: string,
    sendOptions: SendMessageOptions,
  ): AsyncGenerator<StreamEvent> {
    const session = this.options.sessionManager.getOrCreate(sessionId);
    session.context.recordUserTurn(userText);

    const gathered = await session.context.gather(userText);
    const selection = this.options.modelSelection.select({
      hint: sendOptions.routingHint ?? "auto",
      device: sendOptions.device,
      requiresWebSearch: sendOptions.requiresWebSearch,
      requiresAdvancedReasoning: sendOptions.requiresAdvancedReasoning,
      privacySensitive: sendOptions.privacySensitive,
      preferredProviderId: sendOptions.preferredProviderId,
    });

    let messages: ChatMessage[] = this.options.promptBuilder.build(
      gathered,
      userText,
      selection.provider.id,
      this.options.tokenBudget,
    );

    let finalFinishReason: Extract<StreamEvent, { type: "done" }> | undefined;
    let stoppedNaturally = false;

    for (let round = 0; round < this.maxToolRounds; round++) {
      const pendingToolCalls: ToolCallRequest[] = [];
      let roundText = "";
      let sawToolCalls = false;

      const stream = this.runProviderRound(selection.provider, {
        messages,
        tools: this.options.toolRegistry.listSpecs(),
        signal: sendOptions.signal,
      });

      for await (const event of withTimeout(stream, this.streamTimeoutMs)) {
        if (event.type === "text_delta") {
          roundText += event.delta;
          yield event;
        } else if (event.type === "tool_call") {
          sawToolCalls = true;
          pendingToolCalls.push(event.toolCall);
          yield event;
        } else if (event.type === "error") {
          yield event;
          finalFinishReason = { type: "done", finishReason: "error" };
        } else {
          finalFinishReason = event;
        }
      }

      if (roundText.length > 0) {
        session.context.recordAssistantTurn(roundText);
      }

      if (!sawToolCalls || pendingToolCalls.length === 0) {
        stoppedNaturally = true;
        break;
      }

      messages = [
        ...messages,
        ...(roundText.length > 0 ? [{ role: "assistant" as const, content: roundText }] : []),
      ];

      for (const toolCall of pendingToolCalls) {
        const result = await this.options.toolRegistry.invoke(toolCall, {
          sessionId,
          signal: sendOptions.signal,
        });
        session.context.recordToolTurn(result.content);
        messages = [
          ...messages,
          {
            role: "tool",
            content: result.content,
            toolCallId: result.toolCallId,
            name: toolCall.name,
          },
        ];
      }
      // Loop again: the tool results just appended are sent back to the same provider next round.
    }

    if (!stoppedNaturally) {
      // Exhausted maxToolRounds while the model was still requesting tools.
      finalFinishReason = { type: "done", finishReason: "length" };
    }

    const finishReason = finalFinishReason?.finishReason ?? "stop";

    await this.options.eventBus.emit(
      "ai_engine.turn_completed",
      {
        sessionId,
        providerId: selection.provider.id,
        routingTarget: selection.decision.target,
        finishReason,
      },
      "ai-engine",
    );
    await this.options.telemetry?.track({
      name: "ai_engine.turn_completed",
      properties: { providerId: selection.provider.id, routingTarget: selection.decision.target },
    });
    log.info("turn completed", { sessionId, providerId: selection.provider.id, finishReason });

    yield finalFinishReason ?? { type: "done", finishReason: "stop" };
  }

  /** Every provider currently registered, for UI provider pickers / diagnostics. */
  listAvailableProviders(): readonly AIProvider[] {
    return this.options.providerRegistry.list();
  }

  /**
   * Wraps one provider call so a failure before any output streamed is
   * retried (a fresh `streamChat` invocation per attempt, since a thrown
   * async generator can't be resumed) per `retryOptions`. A failure *after*
   * some events already streamed is surfaced as a `StreamEvent.error`
   * instead of being retried, since replaying part of a turn against a
   * second attempt would risk a duplicated or inconsistent reply.
   */
  private async *runProviderRound(
    provider: AIProvider,
    request: Parameters<AIProvider["streamChat"]>[0],
  ): AsyncGenerator<StreamEvent> {
    let iterator: AsyncIterator<StreamEvent>;
    let first: IteratorResult<StreamEvent>;

    try {
      ({ iterator, first } = await retryWithBackoff(async () => {
        const it = provider.streamChat(request)[Symbol.asyncIterator]();
        const firstResult = await it.next();
        return { iterator: it, first: firstResult };
      }, this.retryOptions));
    } catch (err) {
      throw new ProviderError(
        `provider "${provider.id}" failed before streaming any output`,
        provider.id,
        err,
      );
    }

    if (first.done) return;
    yield first.value;

    while (true) {
      let next: IteratorResult<StreamEvent>;
      try {
        next = await iterator.next();
      } catch (err) {
        yield {
          type: "error",
          message: `provider "${provider.id}" failed mid-stream: ${String(err)}`,
        };
        return;
      }
      if (next.done) return;
      yield next.value;
    }
  }
}

export function createAIOrchestrator(options: AIOrchestratorOptions): AIOrchestrator {
  return new AIOrchestrator(options);
}
