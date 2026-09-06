# ADR 0002: `PluginContext` is host-injected, never SDK-implemented

**Status:** Accepted (Phase 9)

## Context

The brief's SDK section requires exposing "stable interfaces for tool
registration, memory access, planner integration, voice integration,
settings, events, configuration, logging, diagnostics, notifications" while
explicitly saying "do not expose internal implementation details." A naive
approach would have `@ryper/plugin-sdk` import `MemoryManager`,
`ToolPluginBridge`, `PlannerPluginRegistry`, `VoiceCommandRouter`, and
`EventBus` directly and implement the access objects itself.

## Decision

`@ryper/plugin-sdk` defines `PluginContext` and its nine sub-interfaces
(`PluginToolAccess`, `PluginMemoryAccess`, `PluginPlannerAccess`,
`PluginVoiceAccess`, `PluginSettingsAccess`, `PluginEventAccess`,
`PluginLoggingAccess`, `PluginDiagnosticsAccess`,
`PluginNotificationsAccess`) as pure TypeScript interfaces — no
implementation, no runtime dependency on the packages they describe. Only
`@ryper/plugin-platform`'s `PluginLoader.buildContext()` constructs a real
implementation, scoping each accessor to the specific plugin it belongs to
(e.g. `memory.recall()` only ever searches memories tagged
`plugin_memory:<pluginId>`, never the whole user memory store).

## Consequences

- A plugin's code can only ever reach Core internals through the exact
  nine methods `PluginContext` exposes — there is no back door to the raw
  `MemoryManager`, `EventBus`, or any other Core singleton, satisfying "do
  not expose internal implementation details" literally rather than by
  convention.
- Swapping the host's implementation (e.g. a future real OS-notification
  API instead of the current `plugin.notification` event) never requires
  a change to `@ryper/plugin-sdk` or to any plugin's code — only to
  `PluginLoader`.
- The cost: a plugin cannot do anything its `PluginContext` doesn't
  explicitly allow, even in principle. This is treated as a feature (least
  privilege), not a limitation — a plugin that legitimately needs a new
  capability should get a new, deliberate addition to `PluginContext`,
  not a workaround.
