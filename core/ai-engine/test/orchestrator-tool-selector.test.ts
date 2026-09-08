import { describe, expect, it } from "vitest";
import { EventBus } from "@ryper/event-bus";
import { ModelRouter } from "@ryper/model-router";
import { LongTermMemory } from "@ryper/memory";

import { ProviderRegistry } from "../src/providers/registry.js";
import { ModelSelectionEngine } from "../src/model-selection.js";
import { PromptBuilder } from "../src/prompt-builder.js";
import { TokenBudgetManager } from "../src/token-budget.js";
import { ToolRegistry } from "../src/tool-calling/registry.js";
import { currentTimeTool } from "../src/tool-calling/builtin-tools.js";
import { SessionManager } from "../src/session-manager.js";
import { AIOrchestrator, type ToolSelector } from "../src/orchestrator.js";
import type { AIProvider, ProviderChatRequest, StreamEvent, ToolDefinition } from "../src/types.js";

function makeTool(name: string): ToolDefinition {
  return {
    spec: {
      name,
      description: `Tool for ${name}`,
      parameters: { type: "object", properties: {} },
    },
    execute: () => `result from ${name}`,
  };
}

describe("AIOrchestrator toolSelector", () => {
  it("passes all registered tools to the provider when no toolSelector is configured", async () => {
    let capturedTools: readonly unknown[] | undefined = undefined;

    const recordingProvider: AIProvider = {
      id: "test-provider",
      kind: "local",
      async *streamChat(request: ProviderChatRequest): AsyncIterable<StreamEvent> {
        capturedTools = request.tools;
        yield { type: "text_delta", delta: "hello" };
        yield { type: "done", finishReason: "stop" };
      },
    };

    const registry = new ProviderRegistry();
    registry.register(recordingProvider);
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(currentTimeTool);
    toolRegistry.register(makeTool("open_app"));

    const orchestrator = new AIOrchestrator({
      providerRegistry: registry,
      modelSelection: new ModelSelectionEngine(new ModelRouter(), registry),
      promptBuilder: new PromptBuilder({ systemPrompt: "test" }),
      tokenBudget: new TokenBudgetManager({ "test-provider": { contextWindow: 4000, reservedForCompletion: 500 } }),
      toolRegistry,
      sessionManager: new SessionManager(new LongTermMemory(), undefined),
      eventBus: new EventBus(),
    });

    const stream = orchestrator.sendMessage("s1", "hi", { device: { platform: "windows", freeRamGB: 8 } });
    for await (const _ of stream) { /* consume */ }

    expect(capturedTools).toBeDefined();
    expect(capturedTools?.length).toBe(2);
  });

  it("passes undefined tools when toolSelector returns an empty array for conversational query", async () => {
    let capturedTools: readonly unknown[] | undefined = "sentinel" as unknown as readonly unknown[];

    const recordingProvider: AIProvider = {
      id: "test-provider",
      kind: "local",
      async *streamChat(request: ProviderChatRequest): AsyncIterable<StreamEvent> {
        capturedTools = request.tools;
        yield { type: "text_delta", delta: "General answer" };
        yield { type: "done", finishReason: "stop" };
      },
    };

    const registry = new ProviderRegistry();
    registry.register(recordingProvider);
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(currentTimeTool);
    toolRegistry.register(makeTool("open_app"));

    const toolSelector: ToolSelector = (_userText, _allTools) => {
      // Pure conversation: zero tools needed
      return [];
    };

    const orchestrator = new AIOrchestrator({
      providerRegistry: registry,
      modelSelection: new ModelSelectionEngine(new ModelRouter(), registry),
      promptBuilder: new PromptBuilder({ systemPrompt: "test" }),
      tokenBudget: new TokenBudgetManager({ "test-provider": { contextWindow: 4000, reservedForCompletion: 500 } }),
      toolRegistry,
      sessionManager: new SessionManager(new LongTermMemory(), undefined),
      eventBus: new EventBus(),
      toolSelector,
    });

    const stream = orchestrator.sendMessage("s1", "Why is the sky blue?", { device: { platform: "windows", freeRamGB: 8 } });
    for await (const _ of stream) { /* consume */ }

    expect(capturedTools).toBeUndefined();
  });

  it("passes filtered subset of tools when toolSelector returns matching tools", async () => {
    let capturedTools: readonly unknown[] | undefined = undefined;

    const recordingProvider: AIProvider = {
      id: "test-provider",
      kind: "local",
      async *streamChat(request: ProviderChatRequest): AsyncIterable<StreamEvent> {
        capturedTools = request.tools;
        yield { type: "text_delta", delta: "Opening..." };
        yield { type: "done", finishReason: "stop" };
      },
    };

    const registry = new ProviderRegistry();
    registry.register(recordingProvider);
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(currentTimeTool);
    toolRegistry.register(makeTool("open_app"));
    toolRegistry.register(makeTool("get_power_status"));

    const toolSelector: ToolSelector = (userText, allTools) => {
      if (userText.includes("open")) {
        return allTools.filter((t) => t.name.startsWith("open"));
      }
      return allTools;
    };

    const orchestrator = new AIOrchestrator({
      providerRegistry: registry,
      modelSelection: new ModelSelectionEngine(new ModelRouter(), registry),
      promptBuilder: new PromptBuilder({ systemPrompt: "test" }),
      tokenBudget: new TokenBudgetManager({ "test-provider": { contextWindow: 4000, reservedForCompletion: 500 } }),
      toolRegistry,
      sessionManager: new SessionManager(new LongTermMemory(), undefined),
      eventBus: new EventBus(),
      toolSelector,
    });

    const stream = orchestrator.sendMessage("s1", "open notepad", { device: { platform: "windows", freeRamGB: 8 } });
    for await (const _ of stream) { /* consume */ }

    expect(capturedTools).toBeDefined();
    expect(capturedTools?.length).toBe(1);
    expect((capturedTools?.[0] as { name: string }).name).toBe("open_app");
  });
});
