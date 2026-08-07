import { describe, expect, it, vi } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { ModelRouter } from "@ryper/model-router";
import { LongTermMemory } from "@ryper/memory";
import { TelemetryClient } from "@ryper/telemetry";

import { ProviderRegistry } from "../src/providers/registry.js";
import { ModelSelectionEngine } from "../src/model-selection.js";
import { PromptBuilder } from "../src/prompt-builder.js";
import { TokenBudgetManager } from "../src/token-budget.js";
import { ToolRegistry } from "../src/tool-calling/registry.js";
import { currentTimeTool } from "../src/tool-calling/builtin-tools.js";
import { SessionManager } from "../src/session-manager.js";
import { AIOrchestrator } from "../src/orchestrator.js";
import type { AIProvider, ProviderChatRequest, StreamEvent } from "../src/types.js";

function buildEngine(provider: AIProvider, telemetry?: TelemetryClient) {
  const eventBus = new EventBus();
  const registry = new ProviderRegistry();
  registry.register(provider);

  const modelSelection = new ModelSelectionEngine(new ModelRouter(), registry);
  const promptBuilder = new PromptBuilder({ systemPrompt: "You are RYPER." });
  const tokenBudget = new TokenBudgetManager({
    [provider.id]: { contextWindow: 8000, reservedForCompletion: 1000 },
  });
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(currentTimeTool);
  const sessionManager = new SessionManager(new LongTermMemory(), undefined);

  const orchestrator = new AIOrchestrator({
    providerRegistry: registry,
    modelSelection,
    promptBuilder,
    tokenBudget,
    toolRegistry,
    sessionManager,
    eventBus,
    telemetry,
    retry: { sleep: async () => {} },
  });

  return { orchestrator, eventBus, sessionManager };
}

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

function textProvider(id: string, chunks: string[]): AIProvider {
  return {
    id,
    kind: "local",
    async *streamChat(): AsyncIterable<StreamEvent> {
      for (const chunk of chunks) yield { type: "text_delta", delta: chunk };
      yield { type: "done", finishReason: "stop" };
    },
  };
}

describe("AIOrchestrator", () => {
  it("streams a plain text reply and records it in the session's context", async () => {
    const { orchestrator, sessionManager } = buildEngine(
      textProvider("local-1", ["Hello", " there"]),
    );

    const events = await collect(
      orchestrator.sendMessage("s1", "hi", { device: { online: false } }),
    );

    expect(events).toEqual([
      { type: "text_delta", delta: "Hello" },
      { type: "text_delta", delta: " there" },
      { type: "done", finishReason: "stop" },
    ]);

    const history = sessionManager.getOrCreate("s1").context.getShortTermMemory().getTurns();
    expect(history.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("emits ai_engine.turn_completed on the event bus after a turn", async () => {
    const { orchestrator, eventBus } = buildEngine(textProvider("local-1", ["hi"]));
    let received: unknown;
    eventBus.on("ai_engine.turn_completed", (event) => {
      received = event.payload;
    });

    await collect(orchestrator.sendMessage("s1", "hi", { device: { online: false } }));
    expect(received).toMatchObject({ providerId: "local-1", finishReason: "stop" });
  });

  it("runs a full tool-calling round trip: tool_call -> invoke -> follow-up round -> stop", async () => {
    let callCount = 0;
    const provider: AIProvider = {
      id: "local-1",
      kind: "local",
      async *streamChat(request: ProviderChatRequest): AsyncIterable<StreamEvent> {
        callCount += 1;
        if (callCount === 1) {
          yield {
            type: "tool_call",
            toolCall: { id: "call1", name: "get_current_time", arguments: {} },
          };
          yield { type: "done", finishReason: "tool_calls" };
        } else {
          // Second round: confirm the tool result made it into the prompt.
          const hasToolMessage = request.messages.some(
            (m) => m.role === "tool" && m.toolCallId === "call1",
          );
          yield {
            type: "text_delta",
            delta: hasToolMessage ? "It is now known." : "missing tool result",
          };
          yield { type: "done", finishReason: "stop" };
        }
      },
    };

    const { orchestrator } = buildEngine(provider);
    const events = await collect(
      orchestrator.sendMessage("s1", "what time is it", { device: { online: false } }),
    );

    expect(events[0]).toMatchObject({ type: "tool_call" });
    expect(events.some((e) => e.type === "text_delta" && e.delta === "It is now known.")).toBe(
      true,
    );
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
    expect(callCount).toBe(2);
  });

  it("stops after maxToolRounds and reports finishReason 'length' if the model keeps requesting tools", async () => {
    const provider: AIProvider = {
      id: "local-1",
      kind: "local",
      async *streamChat(): AsyncIterable<StreamEvent> {
        yield {
          type: "tool_call",
          toolCall: { id: "call-x", name: "get_current_time", arguments: {} },
        };
        yield { type: "done", finishReason: "tool_calls" };
      },
    };

    const eventBus = new EventBus();
    const registry = new ProviderRegistry();
    registry.register(provider);
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(currentTimeTool);
    const orchestrator = new AIOrchestrator({
      providerRegistry: registry,
      modelSelection: new ModelSelectionEngine(new ModelRouter(), registry),
      promptBuilder: new PromptBuilder({ systemPrompt: "sys" }),
      tokenBudget: new TokenBudgetManager({
        "local-1": { contextWindow: 8000, reservedForCompletion: 1000 },
      }),
      toolRegistry,
      sessionManager: new SessionManager(new LongTermMemory(), undefined),
      eventBus,
      maxToolRounds: 2,
      retry: { sleep: async () => {} },
    });

    const events = await collect(
      orchestrator.sendMessage("s1", "loop forever", { device: { online: false } }),
    );
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "length" });
  });

  it("retries a provider that fails before streaming any output, then succeeds", async () => {
    let attempts = 0;
    const provider: AIProvider = {
      id: "local-1",
      kind: "local",
      async *streamChat(): AsyncIterable<StreamEvent> {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("connection refused");
        }
        yield { type: "text_delta", delta: "recovered" };
        yield { type: "done", finishReason: "stop" };
      },
    };

    const { orchestrator } = buildEngine(provider);
    const events = await collect(
      orchestrator.sendMessage("s1", "hi", { device: { online: false } }),
    );
    expect(attempts).toBe(2);
    expect(events).toContainEqual({ type: "text_delta", delta: "recovered" });
  });

  it("surfaces a mid-stream provider failure as an error event instead of throwing", async () => {
    const provider: AIProvider = {
      id: "local-1",
      kind: "local",
      async *streamChat(): AsyncIterable<StreamEvent> {
        yield { type: "text_delta", delta: "partial" };
        throw new Error("connection dropped");
      },
    };

    const { orchestrator } = buildEngine(provider);
    const events = await collect(
      orchestrator.sendMessage("s1", "hi", { device: { online: false } }),
    );
    expect(events[0]).toEqual({ type: "text_delta", delta: "partial" });
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("never calls the telemetry transport unless telemetry is explicitly enabled", async () => {
    const transport = vi.fn();
    const disabledTelemetry = new TelemetryClient({ enabled: false, transport });
    const { orchestrator } = buildEngine(textProvider("local-1", ["hi"]), disabledTelemetry);

    await collect(orchestrator.sendMessage("s1", "hi", { device: { online: false } }));
    expect(transport).not.toHaveBeenCalled();
  });

  it("calls the telemetry transport once telemetry is explicitly enabled", async () => {
    const transport = vi.fn();
    const enabledTelemetry = new TelemetryClient({ enabled: true, transport });
    const { orchestrator } = buildEngine(textProvider("local-1", ["hi"]), enabledTelemetry);

    await collect(orchestrator.sendMessage("s1", "hi", { device: { online: false } }));
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("listAvailableProviders() reflects the registered providers", () => {
    const { orchestrator } = buildEngine(textProvider("local-1", ["hi"]));
    expect(orchestrator.listAvailableProviders().map((p) => p.id)).toEqual(["local-1"]);
  });
});
