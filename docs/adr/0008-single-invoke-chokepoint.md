# ADR 0008: One `invoke()` choke point; Tool Framework integration via a factory, not a core edit

**Status:** Accepted (Phase 10)

## Context

The brief requires "the Tool Calling Framework must invoke capabilities
only through the Platform Capability Layer. No tool may directly depend
on platform-specific APIs." `@ryper/tool-framework`'s `ToolDefinition.execute`
(Phase 8) is already an arbitrary injected function — nothing in Tool
Framework's own code calls an OS API, so there is no Tool Framework logic
to "redirect." The real question is how a _future_ platform-touching tool
gets built so that it can only reach the OS through this layer.

## Decision

1. **`CapabilityManager.invoke()` is the only method that ever calls
   `PlatformAdapter.invoke()`.** Permission check, parameter validation,
   diagnostics, and metrics all happen inside this one method — a caller
   cannot reach the adapter's `invoke()` directly through the manager
   (adapters are only exposed via `activeAdapter()` / `AdapterRegistry`
   for inspection, e.g. `.supports()`/`.getDeviceInfo()`, not for
   invocation).
2. **`createCapabilityTool(manager, domain, operation, spec)`** in
   `tool-integration.ts` is how a real tool gets built: it returns a
   `ToolDefinition` whose `execute` calls `manager.invoke()` and nothing
   else. This is a factory `@ryper/platform-capability` provides — it
   does not modify `@ryper/tool-framework`'s source, because
   `ToolDefinition.execute` already supports exactly this pattern without
   any change.

## Consequences

- "No tool may directly depend on platform-specific APIs" becomes a
  convention enforceable by code review / the factory's existence, not by
  a runtime restriction Tool Framework itself imposes — `execute` is
  still, structurally, an arbitrary function. This is judged acceptable:
  Tool Framework's job is to run _whatever_ `execute` a tool declares;
  policing what that function calls into is this layer's and the
  reviewing engineer's job, the same way `@ryper/plugin-runtime` doesn't
  police what a plugin action's handler calls either.
- Zero changes to `@ryper/tool-framework`'s source in this phase — its
  own test suite passes unmodified, confirmed as part of this phase's
  verification.
- A future phase building real Windows/macOS/etc. tools has one obvious,
  documented path (`createCapabilityTool`) rather than needing to
  rediscover the "only touch the OS through the manager" convention from
  scratch.
