# @ryper/ai-engine — Core AI Engine

Phase 3 of RYPER AI OS. This package is the heart of the assistant: every
future module (voice, documents, browser assistant, automation, desktop and
mobile shells) drives a conversational turn through `AIOrchestrator` rather
than talking to a model provider, the memory system, or the tool registry
directly.

It composes the Phase 1/2 Core packages (`@ryper/event-bus`,
`@ryper/model-router`, `@ryper/memory`, `@ryper/rag`, `@ryper/security`,
`@ryper/telemetry`) without modifying any of them — every dependency is used
through its existing public API.

## Responsibilities → files

| Responsibility                               | File(s)                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| AI Orchestrator                              | `src/orchestrator.ts`                                                                                 |
| Conversation Manager (history, turns)        | `src/context-manager.ts` (`recordUserTurn`/`recordAssistantTurn`/`recordToolTurn`)                    |
| Context Manager (retrieval + sliding window) | `src/context-manager.ts`                                                                              |
| Tool Calling Framework                       | `src/tool-calling/*`                                                                                  |
| Local AI Router / Cloud AI Router            | `src/providers/local.ts` (Ollama-compatible), `src/providers/{openai,anthropic,google}-compatible.ts` |
| Session Manager                              | `src/session-manager.ts`                                                                              |
| Token Budget Manager                         | `src/token-budget.ts`                                                                                 |
| Prompt Builder                               | `src/prompt-builder.ts`                                                                               |
| Model Selection Engine                       | `src/model-selection.ts` (composes `@ryper/model-router` + the provider registry)                     |
| Memory Interface                             | `src/context-manager.ts` wraps `@ryper/memory`                                                        |
| Plugin Interface                             | `src/tool-calling/registry.ts` mirrors `@ryper/plugin-runtime`'s capability-gated invocation pattern  |
| Streaming Response Engine                    | `src/streaming.ts`, `src/providers/sse.ts`, `src/providers/ndjson.ts`                                 |
| Error Recovery                               | `src/error-recovery.ts`                                                                               |
| Logging                                      | uses `@ryper/logging` directly (no new logging code)                                                  |
| Telemetry                                    | uses `@ryper/telemetry` directly, opt-in and off by default                                           |
| Configuration Management                     | `src/config.ts`                                                                                       |

## Supported providers

`AIProvider` (`src/types.ts`) is the one interface every provider
implements. Four adapters ship today, and adding a fifth means writing one
more file like them — nothing else changes:

- `createOpenAICompatibleProvider` — OpenAI Chat Completions SSE format.
- `createAnthropicCompatibleProvider` — Anthropic Messages API SSE format.
- `createGoogleCompatibleProvider` — Gemini `streamGenerateContent` SSE format.
- `createOllamaCompatibleProvider` — local inference via the Ollama-style
  NDJSON `/api/chat` format (the same shape most llama.cpp-based local
  servers converge on).

All four are constructed with an injected `HttpFetch` (`src/providers/transport.ts`)
rather than calling a global `fetch`, so they're fully unit-tested here
against canned responses — no network access, no API keys, no flakiness.
A platform shell supplies a real `HttpFetch` (Node's built-in `fetch`, or a
native HTTP client bridged over IPC) at startup.

## How a future module integrates

```ts
import {
  createProviderRegistry,
  createOpenAICompatibleProvider,
  createOllamaCompatibleProvider,
  createModelSelectionEngine,
  createPromptBuilder,
  createTokenBudgetManager,
  createToolRegistry,
  currentTimeTool,
  createSessionManager,
  createAIOrchestrator,
  loadEngineConfig,
} from "@ryper/ai-engine";
import { ModelRouter } from "@ryper/model-router";
import { EventBus } from "@ryper/event-bus";
import { LongTermMemory } from "@ryper/memory";
import { CapabilityBroker } from "@ryper/security";
import { TelemetryClient } from "@ryper/telemetry";

const config = loadEngineConfig(process.env);

const providers = createProviderRegistry();
providers.register(
  createOllamaCompatibleProvider(
    { id: "local", baseUrl: "http://localhost:11434", model: "llama3" },
    realHttpFetch,
  ),
);
providers.register(
  createOpenAICompatibleProvider(
    { id: "cloud", baseUrl: config.cloudApiBaseUrl, apiKey: config.cloudApiKey, model: "gpt-test" },
    realHttpFetch,
  ),
);

const eventBus = new EventBus();
const broker = new CapabilityBroker(promptUserForConsent);
const toolRegistry = createToolRegistry(broker);
toolRegistry.register(currentTimeTool);
// A future phase's filesystem/browser/document tools register here the same way.

const orchestrator = createAIOrchestrator({
  providerRegistry: providers,
  modelSelection: createModelSelectionEngine(new ModelRouter(eventBus), providers),
  promptBuilder: createPromptBuilder({
    systemPrompt: "You are RYPER, a helpful, privacy-respecting assistant.",
  }),
  tokenBudget: createTokenBudgetManager({
    local: { contextWindow: 8192, reservedForCompletion: 1024 },
    cloud: { contextWindow: 200_000, reservedForCompletion: 8192 },
  }),
  toolRegistry,
  sessionManager: createSessionManager(new LongTermMemory()),
  eventBus,
  telemetry: new TelemetryClient({ enabled: config.telemetryEnabled }),
});

for await (const event of orchestrator.sendMessage("conversation-1", "What time is it?", {
  device: { online: true },
})) {
  // event.type is "text_delta" | "tool_call" | "done" | "error" — a voice
  // module speaks text_delta chunks as they arrive; a desktop shell renders
  // them into the Floating Assistant panel; a browser assistant streams
  // them into a side panel. None of them need to know which provider,
  // which tool, or which memory items produced the reply.
}
```

Any later phase's tool implementations (filesystem, browser, documents,
calendar, notes, email, camera, OCR, plugins) register with
`toolRegistry.register(...)` exactly like `currentTimeTool` does today — the
orchestrator's tool-calling loop requires no changes to support them.

## Design notes worth knowing before extending this package

- **Retry vs. fallback vs. error, precisely scoped.** A provider failing
  _before_ streaming any output is retried (fresh attempt, per
  `retryWithBackoff`). A failure _after_ partial output has streamed is
  surfaced as a `StreamEvent` of type `error` and the turn ends — silently
  retrying mid-stream would risk a duplicated or inconsistent reply.
- **`ModelSelectionEngine` never modifies `@ryper/model-router`.** It calls
  `ModelRouter.decide()` and layers concrete-provider selection on top,
  per the Phase 3 brief's "do not modify unrelated modules" rule.
- **Tool-calling is provider-agnostic.** `ToolSpec`/`ToolCallRequest` are
  normalized in `src/types.ts`; each provider adapter translates its own
  wire format (OpenAI's `tool_calls` deltas, Anthropic's `tool_use` content
  blocks, Gemini's `functionCall` parts) into that shared shape.
- **Local provider tool-calling is intentionally not wired up** — local
  runtime tool-calling support varies too much by model/runtime for a
  one-size adapter today; `createOllamaCompatibleProvider` still fully
  satisfies `AIProvider`.
