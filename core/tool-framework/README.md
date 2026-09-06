# @ryper/tool-framework — Universal Tool Calling Framework

Phase 8 of RYPER AI OS. The execution layer between the Agent Planner and
every future capability:

```
User → Planner → Tool Calling Framework → Platform Adapter → Execution
```

`ToolManager` never contains platform-specific code. Every real OS/app
action lives inside a `ToolDefinition`'s `execute`/`executeStream` — a
future platform adapter (Desktop, Android, iOS, Browser, Automation,
Cloud) registers those; this package only validates, authorizes, runs,
retries, streams, logs, and reports on the call.

## Relationship to `@ryper/ai-engine`'s tool-calling module

`core/ai-engine/src/tool-calling` already exists and was **not**
modified. It's a narrower, different concern: letting an LLM request a
function call mid-conversation and feeding the result back into that same
chat turn. This package is the planner-facing, platform-independent
execution engine for **every** capability category the OS exposes — 24 of
them, extensible — with its own registry, permissions, streaming, queueing,
diagnostics, and plugin/voice/planner integrations that ai-engine's
tool-calling module has no equivalent of. A later phase could have
ai-engine delegate real (non-model-internal) tool calls into
`ToolManager`, but that would mean editing an existing, unrelated package,
which these ground rules don't permit doing unilaterally — it's called out
as an integration gap below instead.

## Reuse — nothing here was reimplemented that already existed

- **Security (`@ryper/security`)**: `ToolPermissionManager` calls
  `CapabilityBroker.requestCapability()`/`hasGrant()`/`revoke()` directly;
  temporary-grant expiry is tracked here only because the broker itself
  has no such concept, and extending it isn't this package's call.
- **Memory System (`@ryper/memory-system`)**: `ToolMemoryIntegration` is a
  thin caller of `MemoryManager`'s public API — history, favorites, and
  settings are all just tagged memories, not a new store.
- **Plugin Runtime (`@ryper/plugin-runtime`)**: `ToolPluginBridge` wraps a
  plugin's existing `PluginRuntime.invoke()` call as a `ToolDefinition` —
  it never re-implements plugin execution, signing, or capability checks.
- **Voice Engine (`@ryper/voice-engine`)**: `createToolVoiceCommandHandler`
  returns a real `VoiceCommandHandler`, the exact interface
  `VoiceCommandRouter.register()` expects.
- **Planner (`@ryper/planner`)**: `PlannerToolBridge` drives a real
  `ExecutionQueue`/`TaskGraph` from `@ryper/planner`, and `ToolScheduler`
  is built directly on `@ryper/planner`'s `SchedulerBackend` contract
  rather than a second clock/timer abstraction.
- **Event Bus (`@ryper/event-bus`)**: every stage that needs to notify
  something (stream chunks, invocation completion) emits over the shared
  `EventBus` instead of a bespoke callback system.

No file in any of those packages was modified.

## Core modules → files

| Module (from the brief)                             | File                     |
| --------------------------------------------------- | ------------------------ |
| Tool Registry, Tool Discovery                       | `tool-registry.ts`       |
| Tool Metadata / Tool Model                          | `types.ts`               |
| Tool Validator                                      | `tool-validator.ts`      |
| Tool Executor                                       | `tool-executor.ts`       |
| Tool Permissions                                    | `tool-permissions.ts`    |
| Tool Context                                        | `tool-context.ts`        |
| Tool Results                                        | `tool-results.ts`        |
| Tool Streaming                                      | `tool-streaming.ts`      |
| Tool Scheduler, Tool Queue                          | `tool-queue.ts`          |
| Tool Cancellation                                   | `tool-cancellation.ts`   |
| Tool Retry, Tool Recovery                           | `tool-retry.ts`          |
| Tool Diagnostics                                    | `tool-diagnostics.ts`    |
| Tool Metrics                                        | `tool-metrics.ts`        |
| Tool Logging                                        | `tool-logging.ts`        |
| Tool Configuration                                  | `tool-configuration.ts`  |
| Plugin support (register/unregister/update/version) | `plugin-integration.ts`  |
| Memory Integration                                  | `memory-integration.ts`  |
| Voice Integration                                   | `voice-integration.ts`   |
| Planner Integration                                 | `planner-integration.ts` |
| Reference tools proving the pipeline works          | `builtin-tools.ts`       |
| Tool Manager (facade / stable execution API)        | `tool-manager.ts`        |

## The execution pipeline, as implemented

`ToolManager.invoke()` runs exactly the brief's pipeline inside
`ToolExecutor`:

capability/permission check → input validation → execution (or streaming
execution, chunk-by-chunk) → output validation → logging/diagnostics/
metrics/memory recording → response. A retry loop wraps the whole thing,
sized by the tool's declared `executionCost` (free/low tools get 3
attempts, high-cost tools get 1), and every attempt shares one
`invocationId` so cancellation and logs correlate correctly across
retries. Timeout and external cancellation are unified: both abort the
same internal `AbortSignal`, and the executor races actual execution
against that signal rather than blindly `await`-ing a promise that might
never resolve.

## Tool categories

`ToolCategory` is a plain `string`, not a closed union — "future
categories must be registerable without modifying the framework" is
satisfied structurally: `BUILTIN_TOOL_CATEGORIES` lists the 24 the brief
names, but `ToolRegistry.register()` accepts any category string, and
`ToolDiscovery.categories()` reflects whatever is actually registered.

## Honest limitations — read before wiring a platform adapter

- **No live execution.** The three `builtin-tools.ts` tools
  (`get_current_time`, `text_transform`, `text_echo_stream`) are
  genuinely functional but deliberately hardware-free, exactly like
  `@ryper/ai-engine`'s `currentTimeTool` proves its own loop. Every
  filesystem/browser/document/calendar/camera/etc. category is planned
  and routable but has no real tool registered yet — that's a platform
  adapter's job in a later phase.
- **`PlannerToolBridge` needs manual route registration.** Nothing
  auto-derives a `taskType.operation → toolId` mapping from a tool's own
  metadata yet; a platform adapter (or a small bootstrap script) must call
  `registerRoute()` for every task shape it wants routed. Auto-derivation
  from `ToolSpec.category`/`examples` is a reasonable follow-up but wasn't
  built speculatively here.
- **Temporary permission grants are enforced only through this package's
  own `ToolPermissionManager.checkAll()`.** `@ryper/security`'s
  `CapabilityBroker` itself has no expiry concept, so anything that reads
  grants directly from the broker (bypassing `ToolPermissionManager`)
  won't see a temporary grant auto-revoke.
- **`ToolValidator`'s JSON-schema subset is intentionally small** (type,
  required, enum, min/max length, min/max, nested object/array). No
  `$ref`, `oneOf`/`anyOf`, `patternProperties`, or format validators. It
  covers everything `builtin-tools.ts` and the test suite need; a richer
  spec would be a deliberate, separate upgrade.
- **`ToolQueue`'s concurrency limit is process-local and in-memory** — it
  bounds how many invocations run at once within this instance, not
  across a distributed deployment.
- **No automatic bridge from `@ryper/ai-engine`'s tool-calling to this
  framework.** They coexist deliberately (see above); unifying them would
  mean editing `ai-engine`, which is out of scope for this phase.

## Performance

- `ToolRegistry`/`ToolDiscovery` are `Map`-backed — O(1) lookup by id, O(n)
  filtered search over the current registered set (no tool list is ever
  hardcoded or re-scanned from disk).
- `ToolQueue` only iterates its pending list on enqueue/drain, and never
  re-sorts more than once per state change.
- `ToolDiagnostics`/`ToolInvocationLogger` are bounded ring buffers
  (defaults: 100 / 500 entries) so a long-running process never
  accumulates unbounded history; `ToolMetrics` is O(1)-space running
  counters per tool instead.
- Streaming chunks are emitted as they arrive (`consumeToolStream`) rather
  than buffered and flushed at the end, so a slow producer doesn't block
  progress reporting.

## Integration: registering and invoking a tool

```ts
import { ToolManager } from "@ryper/tool-framework";

const manager = new ToolManager({
  eventBus, // @ryper/event-bus
  capabilityBroker, // @ryper/security, Phase 1
  memory: memoryManager, // @ryper/memory-system, Phase 5
  pluginRuntime, // @ryper/plugin-runtime, Phase 4
});

manager.registerTool({
  spec: {
    id: "browser.navigate",
    name: "Navigate Browser",
    description: "Opens a URL in the default browser.",
    category: "browser",
    version: "1.0.0",
    author: "browser-agent", // future Phase 9+ package
    capabilities: ["network"],
    permissions: [{ capability: "network" }],
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    outputSchema: {
      type: "object",
      properties: { opened: { type: "boolean" } },
      required: ["opened"],
    },
    examples: [],
    errorCodes: [],
    executionCost: "low",
    timeoutMs: 5000,
    cancellationSupport: true,
    streamingSupport: false,
  },
  execute: async (params) => {
    /* real browser-agent call goes here */
    return { opened: true };
  },
});

const result = await manager.invoke(
  "browser.navigate",
  { url: "https://example.com" },
  "user-1",
  "session-1",
  "windows",
);
```

### Driving an `@ryper/planner` execution plan

```ts
import { PlannerToolBridge } from "@ryper/tool-framework";

const bridge = new PlannerToolBridge(manager); // ToolManager satisfies ToolInvoker
bridge.registerRoute("browser", "navigate", "browser.navigate");

const plan = await plannerEngine.plan({ text: "open example.com", platform: "windows" });
const queue = plannerEngine.buildExecutionQueue(plan);
await bridge.runToCompletion(queue, plan, "user-1", "session-1", "windows");
```

Future platform adapters (Desktop, Android, iOS, Browser, Automation,
Cloud) register real `ToolDefinition`s and route mappings — no change to
`ToolManager` or `PlannerToolBridge` is needed as they arrive.
