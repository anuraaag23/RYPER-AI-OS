# @ryper/planner — Agent Planner & Task Orchestration Engine

Phase 7 of RYPER AI OS. The intelligence layer that turns natural language
into executable plans. `PlannerEngine` never performs a device operation
itself — it produces a validated `ExecutionPlan` (a DAG of abstract
`TaskNode`s) that a future platform agent (Desktop, Android, iOS, Browser,
Automation, Documents, Vision, ...) executes.

## Reuse — nothing here was reimplemented that already existed

- **Security (`@ryper/security`)**: `PermissionValidator` calls
  `CapabilityBroker.requestCapability()` directly for every
  capability-gated task — this package has no consent logic of its own.
- **Memory System (`@ryper/memory-system`)**: `ContextResolver` and
  `PlannerMemoryIntegration` are thin callers of `MemoryManager`'s public
  API (`searchMemories`, `filterMemories`, `createMemoryAuto`) — no
  `MemoryStore`/`MemoryIndex` access, per the brief's "reuse MemoryManager
  through its public API."
- **Voice Engine (`@ryper/voice-engine`)**: `createPlannerVoiceCommandHandler`
  returns a real `VoiceCommandHandler`, the exact interface
  `VoiceCommandRouter.register()` expects — no parallel voice-routing
  layer.
- **Plugin Runtime (`@ryper/plugin-runtime`)**: `PlannerPluginRegistry.discoverActive()`
  cross-checks against `PluginRuntime.listPlugins()` rather than trusting a
  static list.
- **Event Bus (`@ryper/event-bus`)**: `CancellationManager` and
  `ProgressTracker` emit `planner.*` events over the shared `EventBus`
  instead of a bespoke pub/sub mechanism.

No file in any of those packages was modified.

## Core modules → files

| Module (from the brief)                                       | File                     |
| ------------------------------------------------------------- | ------------------------ |
| Intent Parser                                                 | `intent-parser.ts`       |
| Goal Analyzer                                                 | `goal-analyzer.ts`       |
| Task Generator                                                | `task-generator.ts`      |
| Dependency Analyzer / Task Graph                              | `dependency-analyzer.ts` |
| Parallel & Sequential Execution Planners, Execution Queue     | `execution-queue.ts`     |
| Context Resolver                                              | `context-resolver.ts`    |
| Permission Validator, Capability Resolver                     | `capability.ts`          |
| Tool Selector                                                 | `tool-selector.ts`       |
| Retry Planner, Recovery Planner                               | `retry-recovery.ts`      |
| Cancellation Manager, Progress Tracker, Event Bus Integration | `execution-control.ts`   |
| Scheduler Interface                                           | `scheduler.ts`           |
| Plan optimization (merging/dedup/dependency reduction)        | `plan-optimizer.ts`      |
| Memory Integration                                            | `memory-integration.ts`  |
| Voice Integration (conversational planning)                   | `voice-integration.ts`   |
| Plugin support (dynamic task-type discovery)                  | `plugin-registry.ts`     |
| Planner Configuration, Planner Diagnostics                    | `config-diagnostics.ts`  |
| Planner Engine (facade / stable execution API)                | `planner-engine.ts`      |
| Domain types (TaskNode, ExecutionPlan, ...)                   | `types.ts`               |

## Intent understanding

`IntentParser` is a deterministic, rule-based classifier for the six
request shapes the brief lists (simple, multi-step, conditional,
scheduled, parallel, recursive) — see `test/intent-parser.test.ts` for the
brief's own worked examples running end to end. A constructor-injected
`IntentParserFn` lets a smarter NLU backend (an LLM-backed classifier, for
example) take priority, with the deterministic parser as a well-tested
fallback — the same "custom detector first, deterministic fallback second"
pattern `@ryper/voice-engine`'s `IntentDetector` already uses.

## Task graph & execution

`TaskGenerator` classifies each goal clause into an abstract `TaskNode`
(one of the task types in the brief — application, browser, document,
image, video, audio, file, calendar, note, message, call, camera,
smart_home, automation, ai, memory, plugin, cloud, platform). `PlanOptimizer`
then dedupes identical tasks and runs a transitive-reduction pass on
dependencies before `DependencyAnalyzer` builds the DAG and groups tasks
into parallel-safe execution levels. `ExecutionQueue` is the runtime
structure a platform agent drives (`dequeueReady()` /
`markRunning()`/`markSucceeded()`/`markFailed()`/`cancel()`) — the planner
builds it via `PlannerEngine.buildExecutionQueue(plan)` but never calls
those methods itself.

## Capability resolution & graceful degradation

`CapabilityResolver` checks each task type against a per-platform support
table (Windows/macOS/Linux/Android/iOS/Web) and produces a plain-language
alternative — never a hard failure — for anything unsupported on the
current platform. `@ryper/security`'s `Capability` union is intentionally
small, so `taskTypeToCapability` is a deliberately **partial** map: task
types with no entry are capability-free as far as the broker is concerned.
Extending `Capability` itself is `@ryper/security`'s call, not this
package's.

## Memory & voice integration

- `ContextResolver.applyMemoryDefaults()` fills a handful of
  known-defaultable parameters (e.g. `browser.search`'s `site`) from
  remembered preferences (`pref:<key>`-tagged memories) before a plan is
  even finalized — a real behavioral effect on planning, not just
  read-only recall.
- `PlannerMemoryIntegration.recallForIntent()` / `recallKnownRoutines()`
  surface related memories and prior workflows during planning;
  `recordWorkflow()` saves a successful plan as a `task`-typed,
  `workflow`-tagged memory for future recall.
- `ConversationalPlanningSession` drives the brief's worked example
  verbatim: "Open YouTube" → clarifying question → "Yes" → the **same**
  plan object gets its `playlist` parameter patched in, no restart. See
  `test/voice-integration.test.ts`.

## Honest limitations — read before wiring a platform agent

- **No live execution.** `PlannerEngine` produces `ExecutionPlan`s and
  hands out `ExecutionQueue`s; nothing in this package ever calls an OS,
  browser, or app API. That's the platform agents' job, by design.
- **`PluginRuntime` doesn't expose per-action schemas publicly** — only
  `listPlugins()` (manifests) is public. Plugins therefore register twice:
  once with `PluginRuntime` for execution, and once with this package's
  `PlannerPluginRegistry` for planner-side task-schema discovery.
  `discoverActive()` cross-checks the two so a schema outlives its plugin
  by zero calls.
- **`Capability` coverage is partial.** Several task types (note, calendar,
  message, application, smart_home, call, ai, memory, platform) have no
  mapped capability today because `@ryper/security`'s `Capability` union
  doesn't define one — they're planned and routed but never
  permission-gated. This is a real gap, not a placeholder decision.
- **`TaskCondition` evaluation is a fixed three-keyword vocabulary**
  (`always` / `on_success` / `on_failure`) checked against the immediate
  upstream task's terminal state. Real predicate evaluation against live
  device/app state (e.g. actually checking Wi-Fi connectivity) belongs to
  whichever platform agent owns that state — the planner has no channel to
  it yet.
- **`PlannerScheduler`'s default backend is `setTimeout`-based**, scoped to
  the current process. No OS-level scheduler, background task, or
  push-notification integration exists in this repo (no native
  toolchains), so a real "every morning at 7 AM" trigger needs a platform
  shell to supply a `SchedulerBackend` backed by its own OS APIs. The
  bookkeeping (`computeNextRun`, re-arming, cancellation) is real and
  fully tested regardless of which backend sits underneath.
- **Clause-to-task classification is regex-based**, not an LLM call — it
  covers the request patterns in the brief plus a handful of common
  extensions (calls, notes, smart-home, sync, memory recall) and falls
  back to a conversational `ai.respond` task for anything it doesn't
  recognize, rather than failing the whole plan.

## Performance

- `TaskGraph`/`computeExecutionLevels` are O(tasks + edges): a single
  memoized DFS per graph, no repeated re-traversal.
- `PlanOptimizer`'s transitive reduction reuses a memoized reachability
  cache across all tasks in one pass rather than recomputing per-edge.
- `ExecutionQueue.dequeueReady()` only scans pending tasks each call; once
  a task is marked `ready`/`running`/terminal it's never rescanned.
- `PlannerDiagnostics` is a bounded ring buffer (`diagnosticsHistorySize`,
  default 50) — plan history never grows unbounded in a long-running
  process.

## Integration: building and running a plan

```ts
import { PlannerEngine } from "@ryper/planner";

const engine = new PlannerEngine({
  eventBus, // @ryper/event-bus
  capabilityBroker, // @ryper/security, Phase 1
  memory: memoryManager, // @ryper/memory-system, Phase 5
});

const plan = await engine.plan({
  text: "Open YouTube, search for Interstellar soundtrack, play the first result, then lower the volume.",
  platform: "windows",
  actorId: "user-1",
});

// A platform agent drives execution — the planner never does this itself:
const queue = engine.buildExecutionQueue(plan);
while (!queue.isComplete()) {
  const ready = queue.dequeueReady();
  for (const task of ready) {
    queue.markRunning(task.id);
    try {
      const result = await desktopAgent.execute(task); // future Phase 8+ package
      queue.markSucceeded(task.id, result);
    } catch (err) {
      queue.markFailed(task.id, String(err));
    }
  }
}

await engine.recordSuccessfulPlan(plan); // saves a reusable workflow memory
```

Future modules (Desktop Agent, Android Agent, iOS Agent, Browser Agent,
Automation Engine, Cloud Agent) consume `ExecutionPlan`/`ExecutionQueue`
from this stable API — no change to `PlannerEngine` is needed as real
executors replace the routing decisions `ToolSelector` records today.
